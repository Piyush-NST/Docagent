// upload api

import { NextRequest, NextResponse } from 'next/server';
import { uploadDocument, ensureContainerExists } from '@/lib/azure-blob';
import { processDocument } from '@/lib/document-processor';
import { storeDocumentChunks } from '@/lib/vector-store';
import { upsertDocumentRecord } from '@/lib/document-registry';
import { buildFailedOcrReadiness, buildReadyReadiness, isDocumentReady } from '@/lib/document-status';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  REQUEST_BODY_HARD_LIMIT_BYTES,
  SUPPORTED_UPLOAD_LABEL,
  SUPPORTED_UPLOAD_TYPES,
  buildOversizedFileMessage,
  formatBytes,
} from '@/lib/upload-limits';

const STORAGE_TIMEOUT_MS = 20_000;
const RECEIVE_FILE_TIMEOUT_MS = 45_000;
const DOCUMENT_PROCESSING_TIMEOUT_MS = 75_000;
const EMBEDDING_TIMEOUT_MS = 30_000;

class UploadStepTimeoutError extends Error {
  status = 504;

  constructor(message: string) {
    super(message);
    this.name = 'UploadStepTimeoutError';
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new UploadStepTimeoutError(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  try {
    await withTimeout(
      ensureContainerExists(),
      STORAGE_TIMEOUT_MS,
      'Preparing document storage took too long. Please try again.',
    );

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > REQUEST_BODY_HARD_LIMIT_BYTES) {
      return NextResponse.json(
        {
          error: 'FILE_TOO_LARGE',
          message: `This upload is ${formatBytes(contentLength)} including form data, which is above the ${MAX_UPLOAD_LABEL} document processing limit.`,
          maxSize: MAX_UPLOAD_LABEL,
          maxBytes: MAX_UPLOAD_BYTES,
          actualSize: contentLength,
          guidance: 'Compress the file, split it into smaller documents, or upload only the pages you want to ask about.',
        },
        { status: 413 },
      );
    }

    const formData = await withTimeout(
      request.formData(),
      RECEIVE_FILE_TIMEOUT_MS,
      'Receiving the uploaded file took too long. Please try a smaller file or selected pages.',
    );
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!SUPPORTED_UPLOAD_TYPES.includes(file.type as (typeof SUPPORTED_UPLOAD_TYPES)[number])) {
      return NextResponse.json(
        {
          error: 'File type not supported',
          message: `Please upload ${SUPPORTED_UPLOAD_LABEL} files.`,
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: 'FILE_TOO_LARGE',
          message: buildOversizedFileMessage(file.name, file.size),
          maxSize: MAX_UPLOAD_LABEL,
          maxBytes: MAX_UPLOAD_BYTES,
          actualSize: file.size,
          actualSizeLabel: formatBytes(file.size),
          guidance:
            'This project extracts and stores document text in memory during upload, so smaller files keep processing reliable.',
        },
        { status: 413 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log('Uploading to blob storage...');
    const metadata = await withTimeout(
      uploadDocument(buffer, file.name, file.type),
      STORAGE_TIMEOUT_MS,
      'Saving the uploaded file took too long. Please try again with a smaller file.',
    );

    console.log('Processing document...');
    const processedDoc = await withTimeout(
      processDocument(metadata.documentId, buffer, file.name, file.type),
      DOCUMENT_PROCESSING_TIMEOUT_MS,
      'Reading this document took too long. Try compressing it, splitting it, or uploading selected pages.',
    );

    let embeddingsCreated = 0;

    if (isDocumentReady(processedDoc.status) && processedDoc.chunks.length > 0) {
      console.log('Generating embeddings...');
      embeddingsCreated = await withTimeout(
        storeDocumentChunks(metadata.documentId, processedDoc.chunks),
        EMBEDDING_TIMEOUT_MS,
        'Indexing this document took too long. Please try a smaller file.',
      );
    } else {
      console.log('[OCR] Embedding creation skipped');
    }

    const readiness = isDocumentReady(processedDoc.status)
      ? buildReadyReadiness({
          fileSize: metadata.fileSize,
          textLength: processedDoc.rawText.length,
          chunksCreated: processedDoc.totalChunks,
          embeddingsCreated,
          ocrUsed: processedDoc.ocrUsed,
          pages: processedDoc.pages,
        })
      : buildFailedOcrReadiness({
          fileSize: metadata.fileSize,
          ocrUsed: processedDoc.ocrUsed,
          pages: processedDoc.pages,
          errorCode: processedDoc.errorCode,
          userMessage: processedDoc.userMessage,
        });

    upsertDocumentRecord({
      documentId: metadata.documentId,
      fileName: metadata.fileName,
      fileType: metadata.fileType,
      fileSize: metadata.fileSize,
      uploadedAt: metadata.uploadedAt,
      status: readiness.status,
      readiness,
    });

    console.log('Upload complete!');

    return NextResponse.json({
      success: true,
      documentId: metadata.documentId,
      fileName: metadata.fileName,
      fileType: metadata.fileType,
      fileSize: metadata.fileSize,
      uploadedAt: metadata.uploadedAt,
      status: readiness.status,
      processing: {
        status: readiness.status,
        totalChunks: readiness.chunksCreated,
        pages: readiness.pages,
        textLength: readiness.extractedTextLength,
        ocrUsed: readiness.ocrUsed,
        embeddingsCreated: readiness.embeddingsCreated,
        grounded: readiness.grounded,
        indexStatus: readiness.indexStatus,
        retrievalStatus: readiness.retrievalStatus,
        estimatedConfidence: readiness.estimatedConfidence,
        errorCode: readiness.errorCode,
        userMessage: readiness.userMessage,
      },
      message: readiness.status === 'ready' ? 'Document uploaded successfully!' : readiness.userMessage,
    });
  } catch (error) {
    console.error('Upload error:', error);
    const status = error instanceof UploadStepTimeoutError ? error.status : 500;

    return NextResponse.json(
      {
        error: 'Upload failed',
        message: error instanceof Error ? error.message : 'Something went wrong',
      },
      { status },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Upload API',
    supportedTypes: ['PDF', 'DOCX', 'PNG', 'JPG'],
    maxSize: MAX_UPLOAD_LABEL,
  });
}
