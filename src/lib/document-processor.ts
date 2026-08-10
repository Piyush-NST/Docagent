// Document extraction, OCR fallback, chunking

import { v4 as uuidv4 } from 'uuid';
import { isMeaningfulExtractedText } from '@/lib/text-validation';
import type { DocumentProcessingStatus, PageProcessingStats } from '@/lib/document-status';
import { OCR_FAILED_USER_MESSAGE } from '@/lib/document-status';
import { isLikelyPasswordProtectedError } from '@/lib/file-validation';
import {
  MAX_OCR_PAGES,
  OPENROUTER_OCR_MODEL,
  READINESS_THRESHOLDS,
} from '@/lib/config/readiness';

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  page?: number;
  section?: string;
  chunkIndex: number;
  startIndex: number;
  endIndex: number;
  metadata: {
    fileName: string;
    fileType: string;
    extractedAt: string;
  };
}

export interface ProcessedDocument {
  documentId: string;
  fileName: string;
  fileType: string;
  totalChunks: number;
  chunks: DocumentChunk[];
  rawText: string;
  pages?: number;
  ocrUsed: boolean;
  status: DocumentProcessingStatus;
  grounded: boolean;
  errorCode?: string;
  userMessage?: string;
  pageStats?: PageProcessingStats;
  warnings?: string[];
}

type PageTextResult = {
  page: number;
  text: string;
  source: 'native' | 'ocr' | 'failed' | 'skipped';
};

export type OcrProviderFailure = {
  code:
    | 'OCR_ACCESS_DENIED'
    | 'OCR_INVALID_API_KEY'
    | 'OCR_BILLING_REQUIRED'
    | 'OCR_QUOTA_EXCEEDED'
    | 'OCR_RATE_LIMITED'
    | 'OCR_PROVIDER_UNAVAILABLE';
  userMessage: string;
};

class OcrProviderError extends Error {
  constructor(public readonly failure: OcrProviderFailure) {
    super(failure.userMessage);
    this.name = 'OcrProviderError';
  }
}

export function classifyOcrProviderError(error: unknown): OcrProviderFailure {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('401') ||
    normalized.includes('api key not valid') ||
    normalized.includes('api_key_invalid') ||
    normalized.includes('invalid api key')
  ) {
    return {
      code: 'OCR_INVALID_API_KEY',
      userMessage: 'Text recognition is unavailable because the configured OpenRouter API key is invalid.',
    };
  }
  if (normalized.includes('403') || normalized.includes('denied access') || normalized.includes('permission_denied')) {
    return {
      code: 'OCR_ACCESS_DENIED',
      userMessage:
        'The image was uploaded, but the configured OpenRouter account was denied access to the OCR model.',
    };
  }
  if (normalized.includes('402') || normalized.includes('insufficient credits') || normalized.includes('payment')) {
    return {
      code: 'OCR_BILLING_REQUIRED',
      userMessage: 'The image was uploaded, but OpenRouter requires account credit or billing access for OCR.',
    };
  }
  if (normalized.includes('quota') || normalized.includes('resource_exhausted')) {
    return {
      code: 'OCR_QUOTA_EXCEEDED',
      userMessage: 'The image was uploaded, but the OpenRouter text-recognition quota has been exhausted.',
    };
  }
  if (normalized.includes('429') || normalized.includes('rate limit')) {
    return {
      code: 'OCR_RATE_LIMITED',
      userMessage: 'The image was uploaded, but text recognition is temporarily rate limited. Please retry shortly.',
    };
  }
  return {
    code: 'OCR_PROVIDER_UNAVAILABLE',
    userMessage: 'The image was uploaded, but the OpenRouter text-recognition model is currently unavailable.',
  };
}

type OpenRouterOcrResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning?: string | null;
    };
  }>;
  error?: { message?: string };
};

export function extractOpenRouterOcrText(payload: OpenRouterOcrResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => (part.type === 'text' ? part.text || '' : '')).join('\n')
    : content || '';

  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

const PAGE_NATIVE_MIN_CHARS = 40;
const PRIMARY_OCR_TIMEOUT_MS = 15_000;
const RETRY_OCR_TIMEOUT_MS = 15_000;

const PRIMARY_OCR_PROMPT = `Extract ALL readable handwritten and printed text from this image exactly as it appears.
Return only the extracted text, nothing else.
Support English and Hindi (Devanagari).
If no meaningful text is readable, return exactly: NO_READABLE_TEXT`;

const STRICT_OCR_PROMPT = `You are performing OCR on a document image.

Extract every readable handwritten and printed word from the image.

Instructions:
- Preserve the original line order.
- Do not summarise.
- Do not infer or invent unclear words.
- Mark unreadable portions as [unclear].
- Support English and Hindi text.
- Return only the extracted text.
- If no meaningful text is readable, return exactly: NO_READABLE_TEXT`;

async function callOpenRouterOcr(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
  label: string,
  timeoutMs: number,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OcrProviderError({
      code: 'OCR_INVALID_API_KEY',
      userMessage: 'Text recognition is unavailable because OPENROUTER_API_KEY is not configured.',
    });
  }

  console.log(`[OCR] OpenRouter ${label} started with ${OPENROUTER_OCR_MODEL}`);
  const base64 = imageBuffer.toString('base64');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
      'X-Title': 'DocAgent OCR',
    },
    body: JSON.stringify({
      model: OPENROUTER_OCR_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4096,
      reasoning: { enabled: false, exclude: true },
      provider: {
        only: ['NVIDIA'],
        allow_fallbacks: false,
        require_parameters: true,
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let payload: OpenRouterOcrResponse;
  try {
    payload = (await response.json()) as OpenRouterOcrResponse;
  } catch (error) {
    throw new Error(
      `OCR response body could not be read: ${error instanceof Error ? error.message : 'unknown response error'}`,
    );
  }
  if (!response.ok) {
    throw new Error(`[${response.status}] ${payload.error?.message || response.statusText || 'OCR request failed'}`);
  }

  const text = extractOpenRouterOcrText(payload);
  if (!text) {
    const choice = payload.choices?.[0];
    const rawContent = choice?.message?.content;
    console.warn('[OCR] OpenRouter returned an empty OCR response', {
      status: response.status,
      finishReason: choice?.finish_reason,
      contentType: Array.isArray(rawContent) ? 'array' : typeof rawContent,
      contentParts: Array.isArray(rawContent) ? rawContent.length : undefined,
      hasReasoning: Boolean(choice?.message?.reasoning),
      providerError: Boolean(payload.error?.message),
    });
  }
  console.log(`[OCR] OpenRouter ${label} finished with ${text.length} chars`);
  return text;
}

export async function ocrImage(imageBuffer: Buffer, mimeType: string = 'image/png'): Promise<string> {
  try {
    let primary = '';
    try {
      primary = await callOpenRouterOcr(
        imageBuffer,
        mimeType,
        PRIMARY_OCR_PROMPT,
        'attempt',
        PRIMARY_OCR_TIMEOUT_MS,
      );
    } catch (error) {
      console.warn(
        '[OCR] Primary transport attempt failed; retrying once with the strict OCR request:',
        error instanceof Error ? error.message : 'unknown',
      );
    }
    const primaryCheck = isMeaningfulExtractedText(primary);
    if (primaryCheck.ok) return primaryCheck.cleanedText;

    console.log(`[OCR] Primary validation failed: ${primaryCheck.reason || 'unknown'}`);
    console.log('[OCR] Retry triggered with stricter prompt');

    const retry = await callOpenRouterOcr(
      imageBuffer,
      mimeType,
      STRICT_OCR_PROMPT,
      'retry',
      RETRY_OCR_TIMEOUT_MS,
    );
    const retryCheck = isMeaningfulExtractedText(retry);
    if (retryCheck.ok) {
      console.log('[OCR] Retry succeeded');
      return retryCheck.cleanedText;
    }

    console.log(`[OCR] Returned no readable text (${retryCheck.reason || 'NO_READABLE_TEXT'})`);
    return '';
  } catch (err) {
    console.error('[OCR] OpenRouter OCR call failed:', err instanceof Error ? err.message : 'unknown');
    if (err instanceof OcrProviderError) throw err;
    throw new OcrProviderError(classifyOcrProviderError(err));
  }
}

function pageHasUsableNativeText(text: string): boolean {
  const check = isMeaningfulExtractedText(text);
  return check.ok && check.cleanedText.length >= PAGE_NATIVE_MIN_CHARS;
}

function buildPageStats(pages: PageTextResult[]): PageProcessingStats {
  const warnings: string[] = [];
  const nativeTextPages = pages.filter((p) => p.source === 'native').length;
  const ocrPages = pages.filter((p) => p.source === 'ocr').length;
  const ocrFailedPages = pages.filter((p) => p.source === 'failed').length;
  const ocrSkippedPages = pages.filter((p) => p.source === 'skipped').length;
  const processedPages = nativeTextPages + ocrPages;
  const failedPages = ocrFailedPages + ocrSkippedPages;

  if (ocrFailedPages > 0) {
    warnings.push(`${ocrFailedPages} page(s) failed OCR with no usable text.`);
  }
  if (ocrSkippedPages > 0) {
    warnings.push(
      `${ocrSkippedPages} page(s) were skipped because OCR is capped at ${MAX_OCR_PAGES} pages per upload.`,
    );
  }
  if (ocrPages > 0) {
    warnings.push(`OCR succeeded on ${ocrPages} page(s).`);
  }

  return {
    totalPages: pages.length,
    processedPages,
    nativeTextPages,
    ocrPages,
    ocrFailedPages,
    ocrSkippedPages,
    failedPages,
    warnings,
  };
}

async function extractFromPDF(buffer: Buffer): Promise<{
  text: string;
  pages: number;
  ocrUsed: boolean;
  pageStats: PageProcessingStats;
  pageBlocks: Array<{ page: number; text: string }>;
  ocrFailure?: OcrProviderFailure;
}> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const numPages = pdf.numPages;
  console.log(`PDF: ${numPages} pages`);

  let pageTexts: string[] = [];
  let ocrFailure: OcrProviderFailure | undefined;
  try {
    const extracted = await extractText(new Uint8Array(buffer), { mergePages: false });
    const extractedText = extracted.text as string | string[] | undefined;
    if (Array.isArray(extractedText)) {
      pageTexts = extractedText.map((t) => (typeof t === 'string' ? t : String(t || '')));
    } else if (typeof extractedText === 'string') {
      // Fallback: single blob — treat as one unit if only one page, else split weakly
      pageTexts = numPages <= 1 ? [extractedText] : Array.from({ length: numPages }, () => '');
      if (numPages > 1 && extractedText.trim()) {
        // Keep full text as page 1 native when per-page split unavailable
        pageTexts[0] = extractedText;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isLikelyPasswordProtectedError(message)) {
      throw new Error('PASSWORD_PROTECTED');
    }
    throw err;
  }

  while (pageTexts.length < numPages) pageTexts.push('');
  pageTexts = pageTexts.slice(0, numPages);

  const pageResults: PageTextResult[] = [];
  const pagesNeedingOcr: number[] = [];

  for (let i = 0; i < numPages; i++) {
    const pageNum = i + 1;
    const native = pageTexts[i] || '';
    if (pageHasUsableNativeText(native)) {
      pageResults.push({
        page: pageNum,
        text: isMeaningfulExtractedText(native).cleanedText || native.trim(),
        source: 'native',
      });
    } else {
      pagesNeedingOcr.push(pageNum);
      pageResults.push({ page: pageNum, text: '', source: 'failed' });
    }
  }

  let ocrUsed = false;

  if (pagesNeedingOcr.length > 0) {
    console.log(`[OCR] ${pagesNeedingOcr.length} page(s) need OCR fallback`);
    try {
      const { pdf: pdfToImg } = await import('pdf-to-img');
      const pdfDoc = await pdfToImg(buffer, { scale: 2 });
      let rendered = 0;
      let ocrBudget = 0;
      const skippedAfterBudget = new Set<number>();

      for await (const pageImage of pdfDoc) {
        rendered += 1;
        if (!pagesNeedingOcr.includes(rendered)) continue;
        if (ocrBudget >= MAX_OCR_PAGES) {
          skippedAfterBudget.add(rendered);
          const idx = pageResults.findIndex((p) => p.page === rendered);
          if (idx >= 0) pageResults[idx] = { page: rendered, text: '', source: 'skipped' };
          continue;
        }

        ocrBudget += 1;
        console.log(`[OCR] Page ${rendered}/${numPages}...`);
        const imageBuffer = Buffer.from(pageImage);
        const pageText = await ocrImage(imageBuffer, 'image/png');
        ocrUsed = true;

        const idx = pageResults.findIndex((p) => p.page === rendered);
        if (idx >= 0) {
          if (pageText) {
            pageResults[idx] = { page: rendered, text: pageText, source: 'ocr' };
          } else {
            pageResults[idx] = { page: rendered, text: '', source: 'failed' };
          }
        }
      }

      if (skippedAfterBudget.size > 0) {
        console.log(`[OCR] Budget reached (${MAX_OCR_PAGES}); ${skippedAfterBudget.size} page(s) skipped`);
      }
    } catch (ocrError) {
      console.error('PDF OCR failed:', ocrError instanceof Error ? ocrError.message : 'unknown');
      if (ocrError instanceof OcrProviderError) ocrFailure = ocrError.failure;
      ocrUsed = true;
      // Remaining pending pages stay as failed unless already skipped
      for (const pageNum of pagesNeedingOcr) {
        const idx = pageResults.findIndex((p) => p.page === pageNum);
        if (idx >= 0 && pageResults[idx].source !== 'ocr' && pageResults[idx].source !== 'skipped') {
          pageResults[idx] = { page: pageNum, text: '', source: 'failed' };
        }
      }
    }
  }

  const pageStats = buildPageStats(pageResults);
  const pageBlocks = pageResults
    .filter((p) => p.text.trim())
    .map((p) => ({ page: p.page, text: p.text.trim() }));

  const text = pageBlocks.map((b) => `\n--- Page ${b.page} ---\n${b.text}`).join('\n').trim();

  return { text, pages: numPages, ocrUsed, pageStats, pageBlocks, ocrFailure };
}

function htmlTableToMarkdown(html: string): string {
  return html.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    const rows: string[][] = [];
    const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rowMatches) {
      const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) =>
        m[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (!rows.length) return '';

    const width = Math.max(...rows.map((r) => r.length));
    const normalized = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] || ''));
    const header = normalized[0];
    const sep = header.map(() => '---');
    const body = normalized.slice(1);
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
      ...body.map((r) => `| ${r.join(' | ')} |`),
    ];
    return `\n${lines.join('\n')}\n`;
  });
}

async function extractFromDOCX(buffer: Buffer): Promise<{ text: string; warnings: string[] }> {
  const mammoth = await import('mammoth');
  const warnings: string[] = [];

  try {
    const htmlResult = await mammoth.convertToHtml({ buffer });
    let html = htmlResult.value || '';
    html = htmlTableToMarkdown(html);
    const text = html
      .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    if (htmlResult.messages?.length) {
      warnings.push('DOCX converted with library warnings; some formatting may be simplified.');
    }

    if (text) {
      console.log('DOCX extracted via HTML conversion');
      return { text, warnings };
    }
  } catch {
    warnings.push('DOCX HTML conversion failed; fell back to raw text.');
  }

  const raw = await mammoth.extractRawText({ buffer });
  console.log('DOCX extracted via raw text');
  return { text: raw.value || '', warnings };
}

export function detectDocumentType(contentType: string, fileName: string): 'pdf' | 'docx' | 'image' | 'unknown' {
  const ct = contentType.toLowerCase();
  const fn = fileName.toLowerCase();

  if (ct.includes('pdf') || fn.endsWith('.pdf')) return 'pdf';
  if (ct.includes('word') || fn.endsWith('.docx') || fn.endsWith('.doc')) return 'docx';
  if (ct.includes('image') || fn.match(/\.(png|jpg|jpeg)$/)) return 'image';
  return 'unknown';
}

export type PageBlock = { page?: number; text: string; section?: string };

function splitOversizedBlock(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const units = text.split(/\n+|(?<=[.!?])\s+/).map((unit) => unit.trim()).filter(Boolean);
  const pieces: string[] = [];
  let current = '';

  const append = (unit: string) => {
    if (current && current.length + unit.length + 1 > maxLength) {
      pieces.push(current);
      current = '';
    }
    if (unit.length <= maxLength) {
      current = current ? `${current} ${unit}` : unit;
      return;
    }
    for (const word of unit.split(/\s+/)) {
      if (current && current.length + word.length + 1 > maxLength) {
        pieces.push(current);
        current = '';
      }
      current = current ? `${current} ${word}` : word;
    }
  };

  units.forEach(append);
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Chunk page-aware blocks while preserving page metadata and keeping tables together.
 */
export function chunkPageBlocks(
  blocks: PageBlock[],
  size = 500,
  overlap = 50,
): Array<{ content: string; page?: number; section?: string; startIndex: number; endIndex: number }> {
  const chunks: Array<{ content: string; page?: number; section?: string; startIndex: number; endIndex: number }> = [];
  let globalIndex = 0;

  for (const block of blocks) {
    const clean = block.text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!clean) continue;

    // Keep markdown tables as atomic units when possible
    if (clean.includes('| ---') || /^\|.+\|$/m.test(clean)) {
      if (clean.length <= size * 1.5) {
        chunks.push({
          content: clean,
          page: block.page,
          section: block.section || detectSection(clean),
          startIndex: globalIndex,
          endIndex: globalIndex + clean.length,
        });
        globalIndex += clean.length + 2;
        continue;
      }
    }

    const unitSize = Math.max(100, size - overlap);
    const paragraphs = clean.split(/\n\n+/).flatMap((paragraph) => splitOversizedBlock(paragraph, unitSize));
    let current = '';
    let start = globalIndex;

    for (const para of paragraphs) {
      const p = para + '\n\n';
      if (current.length + p.length > size && current.trim()) {
        chunks.push({
          content: current.trim(),
          page: block.page,
          section: block.section || detectSection(current),
          startIndex: start,
          endIndex: globalIndex,
        });
        const overlapText = current.slice(-overlap);
        current = overlapText + p;
        start = globalIndex - overlapText.length;
      } else {
        if (!current) start = globalIndex;
        current += p;
      }
      globalIndex += p.length;
    }

    if (current.trim()) {
      chunks.push({
        content: current.trim(),
        page: block.page,
        section: block.section || detectSection(current),
        startIndex: start,
        endIndex: globalIndex,
      });
    }
  }

  return chunks.filter((c) => c.content.replace(/\s+/g, '').length >= 20);
}

export function chunkText(
  text: string,
  size = 500,
  overlap = 50,
): Array<{ content: string; startIndex: number; endIndex: number; page?: number; section?: string }> {
  return chunkPageBlocks([{ text }], size, overlap);
}

function detectSection(content: string): string | undefined {
  const first = content.split('\n')[0]?.trim();
  if (!first) return undefined;
  if (/^\d+\.?\d*\.?\s/.test(first)) return first.substring(0, 50);
  if (first.length < 60 && first === first.toUpperCase()) return first;
  if (first.startsWith('#')) return first.replace(/^#+\s*/, '').substring(0, 50);
  return undefined;
}

function buildFailedDocument(
  documentId: string,
  fileName: string,
  contentType: string,
  ocrUsed: boolean,
  pages: number | undefined,
  errorCode: string,
  userMessage: string,
  pageStats?: PageProcessingStats,
): ProcessedDocument {
  console.log('[Extract] Chunk creation skipped');
  console.log('[Extract] Embedding creation skipped');
  console.log(`[Extract] Document marked failed (${errorCode})`);

  return {
    documentId,
    fileName,
    fileType: contentType,
    totalChunks: 0,
    chunks: [],
    rawText: '',
    pages,
    ocrUsed,
    status: errorCode === 'PASSWORD_PROTECTED' ? 'failed' : 'ocr_failed',
    grounded: false,
    errorCode,
    userMessage,
    pageStats,
    warnings: pageStats?.warnings,
  };
}

export async function processDocument(
  documentId: string,
  buffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<ProcessedDocument> {
  console.log(`Processing: ${fileName}`);
  const type = detectDocumentType(contentType, fileName);

  if (type === 'unknown') {
    return buildFailedDocument(
      documentId,
      fileName,
      contentType,
      false,
      undefined,
      'UNSUPPORTED_TYPE',
      'Unsupported file type.',
    );
  }

  try {
    let text = '';
    let pages: number | undefined;
    let ocrUsed = false;
    let pageStats: PageProcessingStats | undefined;
    let pageBlocks: PageBlock[] = [];
    let warnings: string[] = [];
    let ocrFailure: OcrProviderFailure | undefined;

    if (type === 'pdf') {
      const pdf = await extractFromPDF(buffer);
      text = pdf.text;
      pages = pdf.pages;
      ocrUsed = pdf.ocrUsed;
      pageStats = pdf.pageStats;
      pageBlocks = pdf.pageBlocks;
      warnings = [...pdf.pageStats.warnings];
      ocrFailure = pdf.ocrFailure;
    } else if (type === 'docx') {
      const docx = await extractFromDOCX(buffer);
      text = docx.text;
      pageBlocks = [{ text: docx.text }];
      warnings = docx.warnings;
    } else {
      const imageText = await ocrImage(buffer, contentType || 'image/png');
      ocrUsed = true;
      text = imageText;
      pageBlocks = imageText ? [{ text: imageText, page: 1 }] : [];
      pageStats = {
        totalPages: 1,
        processedPages: imageText ? 1 : 0,
        nativeTextPages: 0,
        ocrPages: imageText ? 1 : 0,
        ocrFailedPages: imageText ? 0 : 1,
        ocrSkippedPages: 0,
        failedPages: imageText ? 0 : 1,
        warnings: imageText ? [] : ['Image OCR produced no usable text.'],
      };
    }

    const validation = isMeaningfulExtractedText(text, { fileName });
    if (!validation.ok) {
      console.log(`[Extract] Text validation failed: ${validation.reason || 'unknown'}`);
      return buildFailedDocument(
        documentId,
        fileName,
        contentType,
        ocrUsed,
        pages,
        ocrFailure?.code || validation.reason || 'NO_READABLE_TEXT',
        ocrFailure?.userMessage ||
          (type === 'image' ? OCR_FAILED_USER_MESSAGE : 'No usable text could be extracted from this document.'),
        pageStats,
      );
    }

    const cleanText = validation.cleanedText;
    console.log(`Extracted ${cleanText.length} chars`);

    const textChunks = chunkPageBlocks(pageBlocks.length ? pageBlocks : [{ text: cleanText }]);
    if (textChunks.length === 0) {
      return buildFailedDocument(
        documentId,
        fileName,
        contentType,
        ocrUsed,
        pages,
        'EMPTY',
        'Document has no readable content after processing.',
        pageStats,
      );
    }

    const extractedAt = new Date().toISOString();
    const chunks: DocumentChunk[] = textChunks.map((c, i) => ({
      id: uuidv4(),
      documentId,
      content: c.content,
      page: c.page,
      section: c.section || `Chunk ${i + 1}`,
      chunkIndex: i,
      startIndex: c.startIndex,
      endIndex: c.endIndex,
      metadata: { fileName, fileType: contentType, extractedAt },
    }));

    console.log(`Created ${chunks.length} chunks`);

    const hasPartial = Boolean(pageStats && pageStats.processedPages > 0 && pageStats.processedPages < pageStats.totalPages);
    const coverageRatio =
      pageStats && pageStats.totalPages > 0 ? pageStats.processedPages / pageStats.totalPages : 1;
    let status: DocumentProcessingStatus = 'ready';
    if (hasPartial && coverageRatio < READINESS_THRESHOLDS.warningMinPageCoverage) status = 'limited';
    else if (hasPartial || warnings.length > 0) status = 'ready_with_warnings';

    return {
      documentId,
      fileName,
      fileType: contentType,
      totalChunks: chunks.length,
      chunks,
      rawText: cleanText,
      pages,
      ocrUsed,
      status,
      grounded: true,
      pageStats,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof OcrProviderError) {
      console.error(`[Extract] OCR provider failed (${err.failure.code})`);
      return buildFailedDocument(
        documentId,
        fileName,
        contentType,
        true,
        type === 'image' ? 1 : undefined,
        err.failure.code,
        err.failure.userMessage,
        type === 'image'
          ? {
              totalPages: 1,
              processedPages: 0,
              nativeTextPages: 0,
              ocrPages: 0,
              ocrFailedPages: 1,
              ocrSkippedPages: 0,
              failedPages: 1,
              warnings: [err.failure.userMessage],
            }
          : undefined,
      );
    }
    if (message === 'PASSWORD_PROTECTED' || isLikelyPasswordProtectedError(message)) {
      return buildFailedDocument(
        documentId,
        fileName,
        contentType,
        false,
        undefined,
        'PASSWORD_PROTECTED',
        'This document appears to be password protected.',
      );
    }

    console.error('[Extract] Processing failed:', message);
    return buildFailedDocument(
      documentId,
      fileName,
      contentType,
      false,
      undefined,
      'CORRUPT_DOCUMENT',
      'Could not read this document. It may be corrupted or unreadable.',
    );
  }
}
