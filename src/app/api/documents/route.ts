// documents api - list, delete, retry OCR

import { NextRequest, NextResponse } from 'next/server';
import {
  getStoreStats,
  hasDocument,
  deleteDocumentFromStore,
  getDocumentChunks,
  storeDocumentChunks,
} from '@/lib/vector-store';
import { listDocuments, deleteDocument, downloadDocument } from '@/lib/azure-blob';
import {
  getDocumentRecord,
  listDocumentRecords,
  toPersistedDocument,
  upsertDocumentRecord,
} from '@/lib/document-registry';
import { processDocument } from '@/lib/document-processor';
import { buildFailedOcrReadiness, buildReadyReadiness, isDocumentQueryable } from '@/lib/document-status';
import { isPersistenceError } from '@/lib/store';
import { INDEX_VERSION, isCurrentIndexVersion } from '@/lib/config/indexing';
import { deleteVercelBlob, downloadVercelBlob } from '@/lib/vercel-blob';

const retryLocks = new Set<string>();

function mapReadiness(
  recordReadiness: NonNullable<Awaited<ReturnType<typeof getDocumentRecord>>>['readiness'],
  requiresReindex = false,
) {
  const mapped = {
    status: recordReadiness.status,
    fileSize: recordReadiness.fileSize,
    textLength: recordReadiness.extractedTextLength,
    pages: recordReadiness.pages,
    totalChunks: recordReadiness.chunksCreated,
    embeddingsCreated: recordReadiness.embeddingsCreated,
    ocrUsed: recordReadiness.ocrUsed,
    grounded: recordReadiness.grounded,
    indexStatus: recordReadiness.indexStatus,
    retrievalStatus: recordReadiness.retrievalStatus,
    readinessCoverage: recordReadiness.readinessCoverage,
    pageCoveragePercent: recordReadiness.pageCoveragePercent,
    estimatedConfidence: recordReadiness.readinessCoverage,
    pageStats: recordReadiness.pageStats,
    warnings: recordReadiness.warnings,
    errorCode: recordReadiness.errorCode,
    userMessage: recordReadiness.userMessage,
  };
  return requiresReindex
    ? {
        ...mapped,
        status: 'needs_attention' as const,
        grounded: false,
        indexStatus: 'Needs Attention' as const,
        retrievalStatus: 'Failed' as const,
        errorCode: 'INDEX_OUTDATED',
        userMessage: `This document uses an older index. Delete it and upload it again to create index version ${INDEX_VERSION}.`,
      }
    : mapped;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');

    if (documentId) {
      const record = await getDocumentRecord(documentId);
      const inStore = await hasDocument(documentId);

      if (!record && !inStore) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const chunks = await getDocumentChunks(documentId);
      return NextResponse.json({
        documentId,
        chunkCount: chunks.length,
        status: record?.status || (chunks.length > 0 ? 'ready' : 'ocr_failed'),
        readiness: record?.readiness
          ? mapReadiness(record.readiness, !isCurrentIndexVersion(record.indexVersion))
          : undefined,
        indexVersion: record?.indexVersion ?? null,
        requiresReindex: record ? !isCurrentIndexVersion(record.indexVersion) : true,
        chunks: chunks.map((c) => ({
          id: c.id,
          page: c.page,
          section: c.section,
          preview: c.content.substring(0, 100) + '...',
        })),
      });
    }

    const stats = await getStoreStats();
    const blobDocs = await listDocuments();
    const records = await listDocumentRecords();
    const recordMap = new Map(records.map((r) => [r.documentId, r]));

    const documentIds = new Set<string>([
      ...stats.documents.map((d) => d.documentId),
      ...records.map((r) => r.documentId),
      ...blobDocs.map((b) => b.documentId),
    ]);

    const documents = Array.from(documentIds).map((id) => {
      const record = recordMap.get(id);
      const storeDoc = stats.documents.find((d) => d.documentId === id);
      const blob = blobDocs.find((b) => b.documentId === id);
      const requiresReindex = record ? !isCurrentIndexVersion(record.indexVersion) : true;

      return {
        documentId: id,
        fileName: record?.fileName || storeDoc?.fileName || blob?.fileName || 'Unknown',
        fileType: record?.fileType || blob?.fileType,
        chunkCount: record?.chunkCount ?? storeDoc?.chunkCount ?? 0,
        status: requiresReindex ? 'needs_attention' : record?.status || (storeDoc && storeDoc.chunkCount > 0 ? 'ready' : 'ocr_failed'),
        readiness: record?.readiness ? mapReadiness(record.readiness, requiresReindex) : undefined,
        indexVersion: record?.indexVersion ?? null,
        currentIndexVersion: INDEX_VERSION,
        requiresReindex,
        blobInfo: blob,
      };
    });

    return NextResponse.json({
      success: true,
      storageBackend: stats.backend,
      stats: {
        totalDocuments: documents.length,
        totalChunks: stats.totalChunks,
      },
      documents,
    });
  } catch (error) {
    console.error('List docs error:', error);
    if (isPersistenceError(error)) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: 'Failed to list documents', message: 'Could not load documents from storage.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');

    if (!documentId) {
      return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    }

    console.log(`Deleted doc ${documentId}`);
    const existing = await getDocumentRecord(documentId);
    const deletedStore = await deleteDocumentFromStore(documentId);
    const deletedLegacyBlob = await deleteDocument(documentId);
    const deletedVercelBlob = existing?.blobUrl
      ? await deleteVercelBlob(existing.blobUrl).catch(() => false)
      : false;

    return NextResponse.json({
      success: true,
      documentId,
      deletedFromStore: deletedStore,
      deletedFromBlob: deletedLegacyBlob || deletedVercelBlob,
    });
  } catch (error) {
    console.error('Delete doc error:', error);
    if (isPersistenceError(error)) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to delete documents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { action?: string; documentId?: string };

    if (body.action !== 'retry-ocr' || !body.documentId) {
      return NextResponse.json(
        { error: 'Unsupported action', message: 'Use { action: "retry-ocr", documentId }' },
        { status: 400 },
      );
    }

    const documentId = body.documentId;

    if (retryLocks.has(documentId)) {
      return NextResponse.json(
        { error: 'RETRY_IN_PROGRESS', message: 'OCR retry is already running for this document.' },
        { status: 409 },
      );
    }

    retryLocks.add(documentId);
    console.log('[OCR] Retry OCR requested');

    try {
      const existing = await getDocumentRecord(documentId);
      const directBlob = existing?.blobUrl
        ? await downloadVercelBlob(existing.blobUrl, existing.blobAccess || 'private')
        : null;
      const stored = directBlob && existing
        ? {
            data: directBlob.data,
            metadata: {
              documentId,
              fileName: existing.fileName,
              fileType: directBlob.contentType || existing.fileType,
              fileSize: directBlob.size,
              uploadedAt: existing.uploadedAt,
              blobUrl: existing.blobUrl || '',
            },
          }
        : await downloadDocument(documentId);
      if (!stored) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      await deleteDocumentFromStore(documentId);

      const processedDoc = await processDocument(
        documentId,
        stored.data,
        stored.metadata.fileName,
        stored.metadata.fileType,
      );

      let embeddingsCreated = 0;
      if (isDocumentQueryable(processedDoc.status) && processedDoc.chunks.length > 0) {
        const indexed = await storeDocumentChunks(documentId, processedDoc.chunks);
        embeddingsCreated = indexed.embeddingsCreated;
        console.log('[OCR] Retry succeeded');
      } else {
        console.log('[OCR] Retry failed again');
      }

      const readiness = isDocumentQueryable(processedDoc.status)
        ? buildReadyReadiness({
            fileSize: stored.metadata.fileSize,
            textLength: processedDoc.rawText.length,
            chunksCreated: processedDoc.totalChunks,
            embeddingsCreated,
            ocrUsed: processedDoc.ocrUsed,
            pages: processedDoc.pages,
            pageStats: processedDoc.pageStats,
            warnings: processedDoc.warnings,
          })
        : buildFailedOcrReadiness({
            fileSize: stored.metadata.fileSize,
            ocrUsed: processedDoc.ocrUsed,
            pages: processedDoc.pages,
            errorCode: processedDoc.errorCode,
            userMessage: processedDoc.userMessage,
            pageStats: processedDoc.pageStats,
          });

      if (processedDoc.status === 'limited' && readiness.status !== 'needs_attention') {
        readiness.status = 'limited';
        readiness.indexStatus = 'Limited';
      }

      await upsertDocumentRecord(
        toPersistedDocument({
          documentId,
          fileName: stored.metadata.fileName,
          fileType: stored.metadata.fileType,
          fileSize: stored.metadata.fileSize,
          uploadedAt: existing?.uploadedAt || stored.metadata.uploadedAt,
          contentHash: existing?.contentHash,
          blobUrl: existing?.blobUrl,
          blobAccess: existing?.blobAccess,
          status: readiness.status,
          readiness,
        }),
      );

      return NextResponse.json({
        success: isDocumentQueryable(readiness.status),
        documentId,
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
          readinessCoverage: readiness.readinessCoverage,
          pageCoveragePercent: readiness.pageCoveragePercent,
          estimatedConfidence: readiness.readinessCoverage,
          pageStats: readiness.pageStats,
          warnings: readiness.warnings,
          errorCode: readiness.errorCode,
          userMessage: readiness.userMessage,
        },
        message: isDocumentQueryable(readiness.status)
          ? 'OCR retry succeeded. Document is ready.'
          : readiness.userMessage,
      });
    } finally {
      retryLocks.delete(documentId);
    }
  } catch (error) {
    console.error('Retry OCR error:', error);
    if (isPersistenceError(error)) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error: 'Retry OCR failed',
        message: 'OCR retry failed. Please try again.',
      },
      { status: 500 },
    );
  }
}
