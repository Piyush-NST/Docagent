// upload api

import { NextRequest, NextResponse } from 'next/server';
import { uploadDocument, ensureContainerExists } from '@/lib/azure-blob';
import { processDocument } from '@/lib/document-processor';
import { storeDocumentChunks } from '@/lib/vector-store';
import { findDocumentByHash, toPersistedDocument, upsertDocumentRecord } from '@/lib/document-registry';
import {
  buildFailedOcrReadiness,
  buildReadyReadiness,
  isDocumentQueryable,
} from '@/lib/document-status';
import { hashFileBuffer } from '@/lib/file-hash';
import { validateUploadFile } from '@/lib/file-validation';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  REQUEST_BODY_HARD_LIMIT_BYTES,
  formatBytes,
} from '@/lib/upload-limits';
import { isPersistenceError } from '@/lib/store';
import { INDEX_VERSION, isCurrentIndexVersion } from '@/lib/config/indexing';

const STORAGE_TIMEOUT_MS = 20_000;
const RECEIVE_FILE_TIMEOUT_MS = 45_000;
const DOCUMENT_PROCESSING_TIMEOUT_MS = 90_000;
const EMBEDDING_TIMEOUT_MS = 60_000;

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

function toProcessingPayload(readiness: ReturnType<typeof buildReadyReadiness>) {
  return {
    status: readiness.status,
    totalChunks: readiness.chunksCreated,
    pages: readiness.pages,
    textLength: readiness.extractedTextLength,
    ocrUsed: readiness.ocrUsed,
    embeddingsCreated: readiness.embeddingsCreated,
    grounded: readiness.grounded,
    indexStatus: readiness.indexStatus,
    retrievalStatus: readiness.retrievalStatus,
    readinessCoverage: readiness.readinessCoverage,
    pageCoveragePercent: readiness.pageCoveragePercent,
    estimatedConfidence: readiness.readinessCoverage,
    pageStats: readiness.pageStats,
    warnings: readiness.warnings,
    errorCode: readiness.errorCode,
    userMessage: readiness.userMessage,
  };
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
          message: `This upload is above the ${MAX_UPLOAD_LABEL} document processing limit.`,
          maxSize: MAX_UPLOAD_LABEL,
          maxBytes: MAX_UPLOAD_BYTES,
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
      return NextResponse.json({ error: 'No file uploaded', message: 'No file uploaded.' }, { status: 400 });
    }

    const validationError = validateUploadFile({ name: file.name, type: file.type, size: file.size });
    if (validationError) {
      const status = validationError.code === 'FILE_TOO_LARGE' ? 413 : 400;
      return NextResponse.json(
        {
          error: validationError.code,
          message: validationError.message,
          maxSize: MAX_UPLOAD_LABEL,
          maxBytes: MAX_UPLOAD_BYTES,
          actualSize: file.size,
          actualSizeLabel: formatBytes(file.size),
        },
        { status },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentHash = hashFileBuffer(buffer);

    const existing = await findDocumentByHash(contentHash);
    if (existing && isDocumentQueryable(existing.status) && !isCurrentIndexVersion(existing.indexVersion)) {
      return NextResponse.json(
        {
          error: 'INDEX_OUTDATED',
          message: `This file uses an older document index. Delete it and upload it again to create index version ${INDEX_VERSION}.`,
          documentId: existing.documentId,
          currentIndexVersion: INDEX_VERSION,
          storedIndexVersion: existing.indexVersion ?? null,
        },
        { status: 409 },
      );
    }

    if (existing && isDocumentQueryable(existing.status)) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        documentId: existing.documentId,
        fileName: existing.fileName,
        fileType: existing.fileType,
        fileSize: existing.fileSize,
        uploadedAt: existing.uploadedAt,
        status: existing.status,
        processing: toProcessingPayload(existing.readiness),
        message: 'This exact file was already processed.',
      });
    }

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

    if (isDocumentQueryable(processedDoc.status) && processedDoc.chunks.length > 0) {
      console.log('Generating embeddings...');
      const indexed = await withTimeout(
        storeDocumentChunks(metadata.documentId, processedDoc.chunks),
        EMBEDDING_TIMEOUT_MS,
        'Indexing this document took too long. Please try a smaller file.',
      );
      embeddingsCreated = indexed.embeddingsCreated;
    } else {
      console.log('[Extract] Embedding creation skipped');
    }

    const readiness = isDocumentQueryable(processedDoc.status)
      ? buildReadyReadiness({
          fileSize: metadata.fileSize,
          textLength: processedDoc.rawText.length,
          chunksCreated: processedDoc.totalChunks,
          embeddingsCreated,
          ocrUsed: processedDoc.ocrUsed,
          pages: processedDoc.pages,
          pageStats: processedDoc.pageStats,
          warnings: processedDoc.warnings,
        })
      : buildFailedOcrReadiness({
          fileSize: metadata.fileSize,
          ocrUsed: processedDoc.ocrUsed,
          pages: processedDoc.pages,
          errorCode: processedDoc.errorCode,
          userMessage: processedDoc.userMessage,
          pageStats: processedDoc.pageStats,
        });

    // Prefer stronger limited status from processor when coverage is low
    if (processedDoc.status === 'limited' && readiness.status !== 'needs_attention') {
      readiness.status = 'limited';
      readiness.indexStatus = 'Limited';
    } else if (processedDoc.status === 'ready_with_warnings' && readiness.status === 'ready') {
      readiness.status = 'ready_with_warnings';
      readiness.indexStatus = 'Ready with warnings';
    }

    await upsertDocumentRecord(
      toPersistedDocument({
        documentId: metadata.documentId,
        fileName: metadata.fileName,
        fileType: metadata.fileType,
        fileSize: metadata.fileSize,
        uploadedAt: metadata.uploadedAt,
        contentHash,
        status: readiness.status,
        readiness,
      }),
    );

    console.log('Upload complete!');

    const okMessage =
      readiness.status === 'ready'
        ? 'Document uploaded successfully!'
        : readiness.status === 'ready_with_warnings'
          ? 'Document is ready with warnings. Some pages may be incomplete.'
          : readiness.status === 'limited'
            ? readiness.userMessage || 'Document has limited processing coverage.'
            : readiness.userMessage;

    return NextResponse.json({
      success: isDocumentQueryable(readiness.status),
      documentId: metadata.documentId,
      fileName: metadata.fileName,
      fileType: metadata.fileType,
      fileSize: metadata.fileSize,
      uploadedAt: metadata.uploadedAt,
      status: readiness.status,
      processing: toProcessingPayload(readiness),
      message: okMessage,
    });
  } catch (error) {
    console.error('Upload error:', error);

    if (isPersistenceError(error)) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
        },
        { status: error.status },
      );
    }

    if (error instanceof UploadStepTimeoutError) {
      return NextResponse.json({ error: 'UPLOAD_TIMEOUT', message: error.message }, { status: 504 });
    }

    return NextResponse.json(
      {
        error: 'Upload failed',
        message: 'Processing failed before the document became ready. Please try again.',
      },
      { status: 500 },
    );
  }
}
