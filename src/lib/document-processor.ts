// handles document text extraction

import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
}

// ocr using gemini
async function ocrImage(imageBuffer: Buffer, mimeType: string = 'image/png'): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('No GEMINI_API_KEY for OCR');
    return '';
  }

  try {
    console.log('[Gemini] Running OCR on image...');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const base64 = imageBuffer.toString('base64');
    
    const result = await model.generateContent([
      'Extract ALL text from this image exactly as it appears. Return only the extracted text, nothing else. If no text is visible, describe what you see briefly.',
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
    ]);

    const text = result.response.text();
    console.log(`[Gemini] OCR extracted ${text.length} chars`);
    return text;
  } catch (err) {
    console.error('OCR failed:', err);
    return '';
  }
}

// pdf extraction
async function extractFromPDF(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const numPages = pdf.numPages;
  
  console.log(`PDF: ${numPages} pages`);

  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  
  if (text && text.trim().length > 50) {
    console.log(`PDF text extraction: ${text.length} chars`);
    return { text, pages: numPages };
  }

  // scanned pdf maybe, try ocr
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
      
      // dont do more than 5 pages
      if (pageNum >= 5) {
        console.log('[OCR] Limiting to 5 pages');
        break;
      }
    }

    if (allText.trim().length > 0) {
      console.log(`[OCR] Total: ${allText.length} chars`);
      return { text: allText, pages: numPages };
    }
  } catch (ocrError) {
    console.error('PDF OCR failed:', ocrError);
  }

  return { text: text || '', pages: numPages };
}

// docx extraction
async function extractFromDOCX(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  console.log('DOCX extracted');
  return result.value;
}

// image extraction
async function extractFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const text = await ocrImage(buffer, mimeType);
  return text || 'Could not extract text from image';
}

export function detectDocumentType(contentType: string, fileName: string): 'pdf' | 'docx' | 'image' | 'unknown' {
  const ct = contentType.toLowerCase();
  const fn = fileName.toLowerCase();
  
  if (ct.includes('pdf') || fn.endsWith('.pdf')) return 'pdf';
  if (ct.includes('word') || fn.endsWith('.docx') || fn.endsWith('.doc')) return 'docx';
  if (ct.includes('image') || fn.match(/\.(png|jpg|jpeg)$/)) return 'image';
  return 'unknown';
}

export async function extractText(buffer: Buffer, contentType: string, fileName: string): Promise<{ text: string; pages?: number }> {
  const type = detectDocumentType(contentType, fileName);
  
  if (type === 'pdf') return extractFromPDF(buffer);
  if (type === 'docx') return { text: await extractFromDOCX(buffer) };
  if (type === 'image') return { text: await extractFromImage(buffer, contentType) };
  
  throw new Error(`Unsupported file type: ${contentType}`);
}

// splits text into chunks for embedding
export function chunkText(text: string, size = 500, overlap = 50): Array<{ content: string; startIndex: number; endIndex: number }> {
  const chunks: Array<{ content: string; startIndex: number; endIndex: number }> = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return chunks;

  const paragraphs = clean.split(/\n\n+/);
  let current = '', start = 0, idx = 0;

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

// main function to process uploaded doc
export async function processDocument(
  documentId: string,
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<ProcessedDocument> {
  console.log(`Processing: ${fileName}`);
  
  const { text, pages } = await extractText(buffer, contentType, fileName);
  
  if (!text?.trim() || text.trim().length < 10) {
    throw new Error('Could not extract readable text from document.');
  }

  console.log(`Extracted ${text.length} chars`);

  const textChunks = chunkText(text);
  
  if (textChunks.length === 0) {
    throw new Error('Document has no readable content.');
  }

  const chunks: DocumentChunk[] = textChunks.map((c, i) => ({
    id: uuidv4(),
    documentId,
    content: c.content,
    page: pages ? estimatePage(c.startIndex, text.length, pages) : undefined,
    section: detectSection(c.content) || `Chunk ${i + 1}`,
    startIndex: c.startIndex,
    endIndex: c.endIndex,
    metadata: { fileName, fileType: contentType, extractedAt: new Date().toISOString() },
  }));

  console.log(`Created ${chunks.length} chunks`);

  return { documentId, fileName, fileType: contentType, totalChunks: chunks.length, chunks, rawText: text, pages };
}
