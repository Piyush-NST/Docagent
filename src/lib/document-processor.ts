// handles document text extraction

import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { isMeaningfulExtractedText } from '@/lib/text-validation';
import type { DocumentProcessingStatus } from '@/lib/document-status';
import { OCR_FAILED_USER_MESSAGE } from '@/lib/document-status';

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  page?: number;
  section?: string;
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
}

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
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const base64 = imageBuffer.toString('base64');

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType,
        data: base64,
      },
    },
  ]);

  const text = result.response.text()?.trim() || '';
  console.log(`[OCR] ${label} finished with ${text.length} chars`);
  return text;
}

async function ocrImage(imageBuffer: Buffer, mimeType: string = 'image/png'): Promise<string> {
  try {
    const primary = await callGeminiOcr(imageBuffer, mimeType, PRIMARY_OCR_PROMPT, 'attempt');
    const primaryCheck = isMeaningfulExtractedText(primary);

    if (primaryCheck.ok) {
      return primaryCheck.cleanedText;
    }

    console.log(`[OCR] Primary validation failed: ${primaryCheck.reason || 'unknown'}`);
    console.log('[OCR] Retry triggered with stricter prompt');

    const retry = await callGeminiOcr(imageBuffer, mimeType, STRICT_OCR_PROMPT, 'retry');
    const retryCheck = isMeaningfulExtractedText(retry);

    if (retryCheck.ok) {
      console.log('[OCR] Retry succeeded');
      return retryCheck.cleanedText;
    }

    console.log(`[OCR] Retry validation failed: ${retryCheck.reason || 'NO_READABLE_TEXT'}`);
    console.log('[OCR] Returned no readable text');
    return '';
  } catch (err) {
    console.error('[OCR] Gemini OCR call failed:', err instanceof Error ? err.message : 'unknown');
    return '';
  }
}

async function extractFromPDF(buffer: Buffer): Promise<{ text: string; pages: number; ocrUsed: boolean }> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const numPages = pdf.numPages;

  console.log(`PDF: ${numPages} pages`);

  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });

  if (text && isMeaningfulExtractedText(text).ok) {
    console.log(`PDF text extraction: ${text.length} chars`);
    return { text, pages: numPages, ocrUsed: false };
  }

  console.log('[OCR] PDF appears scanned, using Gemini Vision...');

  try {
    const { pdf: pdfToImg } = await import('pdf-to-img');
    const pdfDoc = await pdfToImg(buffer, { scale: 2 });

    let allText = '';
    let pageNum = 0;

    for await (const pageImage of pdfDoc) {
      pageNum++;
      console.log(`[OCR] Page ${pageNum}/${numPages}...`);

      const imageBuffer = Buffer.from(pageImage);
      const pageText = await ocrImage(imageBuffer, 'image/png');

      if (pageText) {
        allText += `\n--- Page ${pageNum} ---\n${pageText}\n`;
      }

      if (pageNum >= 5) {
        console.log('[OCR] Limiting to 5 pages');
        break;
      }
    }

    const pdfOcrCheck = isMeaningfulExtractedText(allText);
    if (pdfOcrCheck.ok) {
      console.log(`[OCR] Total: ${pdfOcrCheck.cleanedText.length} chars`);
      return { text: pdfOcrCheck.cleanedText, pages: numPages, ocrUsed: true };
    }
  } catch (ocrError) {
    console.error('PDF OCR failed:', ocrError instanceof Error ? ocrError.message : 'unknown');
  }

  return { text: '', pages: numPages, ocrUsed: true };
}

async function extractFromDOCX(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  console.log('DOCX extracted');
  return result.value;
}

async function extractFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  return ocrImage(buffer, mimeType);
}

export function detectDocumentType(contentType: string, fileName: string): 'pdf' | 'docx' | 'image' | 'unknown' {
  const ct = contentType.toLowerCase();
  const fn = fileName.toLowerCase();

  if (ct.includes('pdf') || fn.endsWith('.pdf')) return 'pdf';
  if (ct.includes('word') || fn.endsWith('.docx') || fn.endsWith('.doc')) return 'docx';
  if (ct.includes('image') || fn.match(/\.(png|jpg|jpeg)$/)) return 'image';
  return 'unknown';
}

export async function extractText(
  buffer: Buffer,
  contentType: string,
  fileName: string,
): Promise<{ text: string; pages?: number; ocrUsed: boolean }> {
  const type = detectDocumentType(contentType, fileName);

  if (type === 'pdf') return extractFromPDF(buffer);
  if (type === 'docx') return { text: await extractFromDOCX(buffer), ocrUsed: false };
  if (type === 'image') return { text: await extractFromImage(buffer, contentType), ocrUsed: true };

  throw new Error(`Unsupported file type: ${contentType}`);
}

export function chunkText(
  text: string,
  size = 500,
  overlap = 50,
): Array<{ content: string; startIndex: number; endIndex: number }> {
  const chunks: Array<{ content: string; startIndex: number; endIndex: number }> = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return chunks;

  const paragraphs = clean.split(/\n\n+/);
  let current = '';
  let start = 0;
  let idx = 0;

  for (const para of paragraphs) {
    const p = para + '\n\n';
    if (current.length + p.length > size && current) {
      chunks.push({ content: current.trim(), startIndex: start, endIndex: idx });
      current = current.slice(-overlap) + p;
      start = idx - overlap;
    } else {
      if (!current) start = idx;
      current += p;
    }
    idx += p.length;
  }

  if (current.trim()) {
    chunks.push({ content: current.trim(), startIndex: start, endIndex: idx });
  }

  return chunks;
}

function estimatePage(start: number, total: number, pages: number): number {
  if (!pages || pages <= 1) return 1;
  return Math.min(Math.floor(start / (total / pages)) + 1, pages);
}

function detectSection(content: string): string | undefined {
  const first = content.split('\n')[0]?.trim();
  if (!first) return undefined;
  if (/^\d+\.?\d*\.?\s/.test(first)) return first.substring(0, 50);
  if (first.length < 60 && first === first.toUpperCase()) return first;
  return undefined;
}

function buildFailedDocument(
  documentId: string,
  fileName: string,
  contentType: string,
  ocrUsed: boolean,
  pages: number | undefined,
  errorCode: string,
): ProcessedDocument {
  console.log('[OCR] Chunk creation skipped');
  console.log('[OCR] Embedding creation skipped');
  console.log(`[OCR] Document marked as ocr_failed (${errorCode})`);

  return {
    documentId,
    fileName,
    fileType: contentType,
    totalChunks: 0,
    chunks: [],
    rawText: '',
    pages,
    ocrUsed,
    status: 'ocr_failed',
    grounded: false,
    errorCode,
    userMessage: OCR_FAILED_USER_MESSAGE,
  };
}

export async function processDocument(
  documentId: string,
  buffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<ProcessedDocument> {
  console.log(`Processing: ${fileName}`);

  const { text, pages, ocrUsed } = await extractText(buffer, contentType, fileName);
  const validation = isMeaningfulExtractedText(text, { fileName });

  if (!validation.ok) {
    console.log(`[OCR] Text validation failed: ${validation.reason || 'unknown'}`);
    return buildFailedDocument(
      documentId,
      fileName,
      contentType,
      ocrUsed,
      pages,
      validation.reason || 'NO_READABLE_TEXT',
    );
  }

  const cleanText = validation.cleanedText;
  console.log(`Extracted ${cleanText.length} chars`);

  const textChunks = chunkText(cleanText);

  if (textChunks.length === 0) {
    console.log('[OCR] Text validation failed: no chunks after split');
    return buildFailedDocument(documentId, fileName, contentType, ocrUsed, pages, 'EMPTY');
  }

  const chunks: DocumentChunk[] = textChunks.map((c, i) => ({
    id: uuidv4(),
    documentId,
    content: c.content,
    page: pages ? estimatePage(c.startIndex, cleanText.length, pages) : undefined,
    section: detectSection(c.content) || `Chunk ${i + 1}`,
    startIndex: c.startIndex,
    endIndex: c.endIndex,
    metadata: { fileName, fileType: contentType, extractedAt: new Date().toISOString() },
  }));

  console.log(`Created ${chunks.length} chunks`);

  return {
    documentId,
    fileName,
    fileType: contentType,
    totalChunks: chunks.length,
    chunks,
    rawText: cleanText,
    pages,
    ocrUsed,
    status: 'ready',
    grounded: true,
  };
}
