// documents api - list and delete

import { NextRequest, NextResponse } from 'next/server';
import { getStoreStats, hasDocument, deleteDocumentFromStore, getDocumentChunks } from '@/lib/vector-store';
import { listDocuments, deleteDocument } from '@/lib/azure-blob';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');

    if (documentId) {
      if (!hasDocument(documentId)) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const chunks = getDocumentChunks(documentId);
      return NextResponse.json({
        documentId,
        chunkCount: chunks.length,
        chunks: chunks.map(c => ({
          id: c.id,
          page: c.page,
          section: c.section,
          preview: c.content.substring(0, 100) + '...',
        })),
      });
    }

    const stats = getStoreStats();
    const blobDocs = await listDocuments();

    return NextResponse.json({
      success: true,
      stats: {
        totalDocuments: stats.totalDocuments,
        totalChunks: stats.totalChunks,
      },
      documents: stats.documents.map(doc => ({
        ...doc,
        blobInfo: blobDocs.find(b => b.documentId === doc.documentId),
      })),
    });

  } catch (error) {
    console.error('List docs error:', error);
    return NextResponse.json(
      { error: 'Failed to list documents' },
      { status: 500 }
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
    const deletedStore = deleteDocumentFromStore(documentId);
    const deletedBlob = await deleteDocument(documentId);

    return NextResponse.json({
      success: true,
      documentId,
      deletedFromStore: deletedStore,
      deletedFromBlob: deletedBlob,
    });

  } catch (error) {
    console.error('Delete doc error:', error);
    return NextResponse.json(
      { error: 'Failed to delete document' },
      { status: 500 }
    );
  }
}
