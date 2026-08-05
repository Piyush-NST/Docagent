/**
 * Document metadata access — backed by persistent DocAgentStore.
 * Kept as a thin async façade so API routes stay readable.
 */

import type { DocumentReadinessPayload, DocumentProcessingStatus } from './document-status';
import { getStore } from './store';
import type { PersistedDocument } from './store/types';
import { INDEX_VERSION } from './config/indexing';

export type DocumentRecord = PersistedDocument;

export async function upsertDocumentRecord(record: DocumentRecord): Promise<void> {
  await getStore().upsertDocument(record);
}

export async function getDocumentRecord(documentId: string): Promise<DocumentRecord | undefined> {
  return (await getStore().getDocument(documentId)) || undefined;
}

export async function findDocumentByHash(contentHash: string): Promise<DocumentRecord | undefined> {
  return (await getStore().findDocumentByHash(contentHash)) || undefined;
}

export async function listDocumentRecords(): Promise<DocumentRecord[]> {
  return getStore().listDocuments();
}

export async function deleteDocumentRecord(documentId: string): Promise<boolean> {
  return getStore().deleteDocument(documentId);
}

export async function hasDocumentRecord(documentId: string): Promise<boolean> {
  return Boolean(await getStore().getDocument(documentId));
}

export function toPersistedDocument(args: {
  documentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  contentHash?: string;
  blobUrl?: string;
  blobAccess?: 'private' | 'public';
  status: DocumentProcessingStatus;
  readiness: DocumentReadinessPayload;
}): DocumentRecord {
  const stats = args.readiness.pageStats;
  return {
    documentId: args.documentId,
    fileName: args.fileName,
    fileType: args.fileType,
    fileSize: args.fileSize,
    contentHash: args.contentHash,
    blobUrl: args.blobUrl,
    blobAccess: args.blobAccess,
    uploadedAt: args.uploadedAt,
    status: args.status,
    readiness: args.readiness,
    pages: args.readiness.pages,
    processedPages: stats?.processedPages,
    nativeTextPages: stats?.nativeTextPages,
    ocrPages: stats?.ocrPages,
    ocrFailedPages: stats?.ocrFailedPages,
    ocrSkippedPages: stats?.ocrSkippedPages,
    chunkCount: args.readiness.chunksCreated,
    warnings: args.readiness.warnings,
    indexVersion: INDEX_VERSION,
  };
}
