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
  deleteDocumentRecord,
  getDocumentRecord,
  listDocumentRecords,
  upsertDocumentRecord,
} from '@/lib/document-registry';
import { processDocument } from '@/lib/document-processor';
import { buildFailedOcrReadiness, buildReadyReadiness, isDocumentReady } from '@/lib/document-status';

const retryLocks = new Set<string>();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');

    if (documentId) {
      const record = getDocumentRecord(documentId);
      const inStore = hasDocument(documentId);

      if (!record && !inStore) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const chunks = getDocumentChunks(documentId);
      return NextResponse.json({
        documentId,
        chunkCount: chunks.length,
        status: record?.status || (chunks.length > 0 ? 'ready' : 'ocr_failed'),
        readiness: record?.readiness,
        chunks: chunks.map((c) => ({
          id: c.id,
          page: c.page,
          section: c.section,
          preview: c.content.substring(0, 100) + '...',
        })),
      });
    }

    const stats = getStoreStats();
    const blobDocs = await listDocuments();
    const records = listDocumentRecords();
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

      return {
        documentId: id,
        fileName: record?.fileName || storeDoc?.fileName || blob?.fileName || 'Unknown',
        fileType: record?.fileType || blob?.fileType,
        chunkCount: record?.readiness.chunksCreated ?? storeDoc?.chunkCount ?? 0,
        status: record?.status || (storeDoc && storeDoc.chunkCount > 0 ? 'ready' : 'ocr_failed'),
        readiness: record?.readiness
          ? {
              status: record.readiness.status,
              fileSize: record.readiness.fileSize,
              textLength: record.readiness.extractedTextLength,
              pages: record.readiness.pages,
              totalChunks: record.readiness.chunksCreated,
              embeddingsCreated: record.readiness.embeddingsCreated,
              ocrUsed: record.readiness.ocrUsed,
              grounded: record.readiness.grounded,
              indexStatus: record.readiness.indexStatus,
              retrievalStatus: record.readiness.retrievalStatus,
              estimatedConfidence: record.readiness.estimatedConfidence,
              errorCode: record.readiness.errorCode,
              userMessage: record.readiness.userMessage,
            }
          : undefined,
        blobInfo: blob,
      };
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalDocuments: documents.length,
        totalChunks: stats.totalChunks,
      },
      documents,
    });
  } catch (error) {
    console.error('List docs error:', error);
    return NextResponse.json({ error: 'Failed to list documents' }, { status: 500 });
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
    const deletedStore = deleteDocumentFromStore(documentId);
    const deletedBlob = await deleteDocument(documentId);
    deleteDocumentRecord(documentId);

    return NextResponse.json({
      success: true,
      documentId,
      deletedFromStore: deletedStore,
      deletedFromBlob: deletedBlob,
    });
  } catch (error) {
    console.error('Delete doc error:', error);
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
      const stored = await downloadDocument(documentId);
      if (!stored) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      // Clear previous failed index before reprocessing
      deleteDocumentFromStore(documentId);

      const processedDoc = await processDocument(
        documentId,
        stored.data,
        stored.metadata.fileName,
        stored.metadata.fileType,
      );

      let embeddingsCreated = 0;
      if (isDocumentReady(processedDoc.status) && processedDoc.chunks.length > 0) {
        embeddingsCreated = await storeDocumentChunks(documentId, processedDoc.chunks);
        console.log('[OCR] Retry succeeded');
      } else {
        console.log('[OCR] Retry failed again');
      }

      const readiness = isDocumentReady(processedDoc.status)
        ? buildReadyReadiness({
            fileSize: stored.metadata.fileSize,
            textLength: processedDoc.rawText.length,
            chunksCreated: processedDoc.totalChunks,
            embeddingsCreated,
            ocrUsed: processedDoc.ocrUsed,
            pages: processedDoc.pages,
          })
        : buildFailedOcrReadiness({
            fileSize: stored.metadata.fileSize,
            ocrUsed: processedDoc.ocrUsed,
            pages: processedDoc.pages,
            errorCode: processedDoc.errorCode,
            userMessage: processedDoc.userMessage,
          });

      const existing = getDocumentRecord(documentId);
      upsertDocumentRecord({
        documentId,
        fileName: stored.metadata.fileName,
        fileType: stored.metadata.fileType,
        fileSize: stored.metadata.fileSize,
        uploadedAt: existing?.uploadedAt || stored.metadata.uploadedAt,
        status: readiness.status,
        readiness,
      });

      return NextResponse.json({
        success: readiness.status === 'ready',
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
          estimatedConfidence: readiness.estimatedConfidence,
          errorCode: readiness.errorCode,
          userMessage: readiness.userMessage,
        },
        message:
          readiness.status === 'ready'
            ? 'OCR retry succeeded. Document is ready.'
            : readiness.userMessage,
      });
    } finally {
      retryLocks.delete(documentId);
    }
  } catch (error) {
    console.error('Retry OCR error:', error);
    return NextResponse.json(
      {
        error: 'Retry OCR failed',
        message: error instanceof Error ? error.message : 'Something went wrong',
      },
      { status: 500 },
    );
  }
}
