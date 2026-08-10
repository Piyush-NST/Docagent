// upload api

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { uploadDocument, ensureContainerExists, type DocumentMetadata } from '@/lib/azure-blob';
import { processDocument } from '@/lib/document-processor';
import { storeDocumentChunks } from '@/lib/vector-store';
import { findDocumentByHash, toPersistedDocument, upsertDocumentRecord } from '@/lib/document-registry';
import {
  buildFailedOcrReadiness,
  buildIndexingReadiness,
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
import { deleteVercelBlob, downloadVercelBlob, isVercelBlobUrl } from '@/lib/vercel-blob';

export const maxDuration = 300;

const STORAGE_TIMEOUT_MS = 20_000;
const RECEIVE_FILE_TIMEOUT_MS = 45_000;
const DOCUMENT_PROCESSING_TIMEOUT_MS = 90_000;
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
    const requestType = request.headers.get('content-type') || '';
    let buffer: Buffer;
    let fileName: string;
    let fileType: string;
    let directMetadata: DocumentMetadata | undefined;
    let sourceBlobUrl: string | undefined;
    let sourceBlobAccess: 'private' | 'public' | undefined;

    if (requestType.includes('application/json')) {
      const body = (await request.json()) as {
        blobUrl?: string;
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        blobAccess?: 'private' | 'public';
      };

      if (!body.blobUrl || !isVercelBlobUrl(body.blobUrl) || !body.fileName) {
        return NextResponse.json(
          { error: 'INVALID_BLOB_UPLOAD', message: 'The uploaded document reference is invalid.' },
          { status: 400 },
        );
      }

      const downloaded = await withTimeout(
        downloadVercelBlob(body.blobUrl, 'private'),
        RECEIVE_FILE_TIMEOUT_MS,
        'Receiving the uploaded file took too long. Please try a smaller file or selected pages.',
      );
      if (!downloaded) {
        return NextResponse.json(
          { error: 'BLOB_DOWNLOAD_FAILED', message: 'The uploaded document could not be retrieved.' },
          { status: 400 },
        );
      }
      buffer = downloaded.data;
      fileName = body.fileName;
      fileType = downloaded.contentType || body.fileType || 'application/octet-stream';
      sourceBlobUrl = body.blobUrl;
      sourceBlobAccess = 'private';
      directMetadata = {
        documentId: uuidv4(),
        fileName,
        fileType,
        fileSize: buffer.length,
        uploadedAt: new Date().toISOString(),
        blobUrl: body.blobUrl,
      };
    } else {
      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > REQUEST_BODY_HARD_LIMIT_BYTES) {
        return NextResponse.json(
          {
            error: 'DIRECT_UPLOAD_REQUIRED',
            message: `Files above ${formatBytes(REQUEST_BODY_HARD_LIMIT_BYTES)} must use secure direct upload.`,
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

      fileName = file.name;
      fileType = file.type;
      buffer = Buffer.from(await file.arrayBuffer());
    }

    const validationError = validateUploadFile({ name: fileName, type: fileType, size: buffer.length });
    if (validationError) {
      const status = validationError.code === 'FILE_TOO_LARGE' ? 413 : 400;
      return NextResponse.json(
        {
          error: validationError.code,
          message: validationError.message,
          maxSize: MAX_UPLOAD_LABEL,
          maxBytes: MAX_UPLOAD_BYTES,
          actualSize: buffer.length,
          actualSizeLabel: formatBytes(buffer.length),
        },
        { status },
      );
    }

    const contentHash = hashFileBuffer(buffer);

    const existing = await findDocumentByHash(contentHash);
    if (existing && isDocumentQueryable(existing.status) && !isCurrentIndexVersion(existing.indexVersion)) {
      if (sourceBlobUrl) await deleteVercelBlob(sourceBlobUrl).catch(() => undefined);
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
      if (sourceBlobUrl) await deleteVercelBlob(sourceBlobUrl).catch(() => undefined);
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

    let metadata = directMetadata;
    if (!metadata) {
      await withTimeout(
        ensureContainerExists(),
        STORAGE_TIMEOUT_MS,
        'Preparing document storage took too long. Please try again.',
      );
      console.log('Uploading to document storage...');
      metadata = await withTimeout(
        uploadDocument(buffer, fileName, fileType),
        STORAGE_TIMEOUT_MS,
        'Saving the uploaded file took too long. Please try again with a smaller file.',
      );
    }

    console.log('Processing document...');
    const processedDoc = await withTimeout(
      processDocument(metadata.documentId, buffer, fileName, fileType),
      DOCUMENT_PROCESSING_TIMEOUT_MS,
      'Reading this document took too long. Try compressing it, splitting it, or uploading selected pages.',
    );

    let embeddingsCreated = 0;

    if (isDocumentQueryable(processedDoc.status) && processedDoc.chunks.length > 0) {
      // PostgreSQL chunks reference documents, so persist the parent before indexing.
      const indexingReadiness = buildIndexingReadiness({
        fileSize: metadata.fileSize,
        textLength: processedDoc.rawText.length,
        ocrUsed: processedDoc.ocrUsed,
        pages: processedDoc.pages,
        pageStats: processedDoc.pageStats,
      });
      await upsertDocumentRecord(
        toPersistedDocument({
          documentId: metadata.documentId,
          fileName: metadata.fileName,
          fileType: metadata.fileType,
          fileSize: metadata.fileSize,
          uploadedAt: metadata.uploadedAt,
          blobUrl: sourceBlobUrl,
          blobAccess: sourceBlobAccess,
          status: indexingReadiness.status,
          readiness: indexingReadiness,
        }),
      );

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
        blobUrl: sourceBlobUrl,
        blobAccess: sourceBlobAccess,
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
