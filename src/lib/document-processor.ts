// Document extraction, OCR fallback, chunking

import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { isMeaningfulExtractedText } from '@/lib/text-validation';
import type { DocumentProcessingStatus, PageProcessingStats } from '@/lib/document-status';
import { OCR_FAILED_USER_MESSAGE } from '@/lib/document-status';
import { isLikelyPasswordProtectedError } from '@/lib/file-validation';
import { MAX_OCR_PAGES, READINESS_THRESHOLDS } from '@/lib/config/readiness';

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

const PAGE_NATIVE_MIN_CHARS = 40;

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

async function callGeminiOcr(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
  label: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[OCR] No GEMINI_API_KEY for OCR');
    return '';
  }

  console.log(`[OCR] ${label} started`);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });
  const base64 = imageBuffer.toString('base64');

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType, data: base64 } },
  ]);

  const text = result.response.text()?.trim() || '';
  console.log(`[OCR] ${label} finished with ${text.length} chars`);
  return text;
}

export async function ocrImage(imageBuffer: Buffer, mimeType: string = 'image/png'): Promise<string> {
  try {
    const primary = await callGeminiOcr(imageBuffer, mimeType, PRIMARY_OCR_PROMPT, 'attempt');
    const primaryCheck = isMeaningfulExtractedText(primary);
    if (primaryCheck.ok) return primaryCheck.cleanedText;

    console.log(`[OCR] Primary validation failed: ${primaryCheck.reason || 'unknown'}`);
    console.log('[OCR] Retry triggered with stricter prompt');

    const retry = await callGeminiOcr(imageBuffer, mimeType, STRICT_OCR_PROMPT, 'retry');
    const retryCheck = isMeaningfulExtractedText(retry);
    if (retryCheck.ok) {
      console.log('[OCR] Retry succeeded');
      return retryCheck.cleanedText;
    }

    console.log(`[OCR] Returned no readable text (${retryCheck.reason || 'NO_READABLE_TEXT'})`);
    return '';
  } catch (err) {
    console.error('[OCR] Gemini OCR call failed:', err instanceof Error ? err.message : 'unknown');
    return '';
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
}> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const numPages = pdf.numPages;
  console.log(`PDF: ${numPages} pages`);

  let pageTexts: string[] = [];
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

  return { text, pages: numPages, ocrUsed, pageStats, pageBlocks };
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

    const paragraphs = clean.split(/\n\n+/);
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

    if (type === 'pdf') {
      const pdf = await extractFromPDF(buffer);
      text = pdf.text;
      pages = pdf.pages;
      ocrUsed = pdf.ocrUsed;
      pageStats = pdf.pageStats;
      pageBlocks = pdf.pageBlocks;
      warnings = [...pdf.pageStats.warnings];
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
        validation.reason || 'NO_READABLE_TEXT',
        type === 'image' ? OCR_FAILED_USER_MESSAGE : 'No usable text could be extracted from this document.',
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
