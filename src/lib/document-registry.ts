import type { DocumentReadinessPayload, DocumentProcessingStatus } from './document-status';

export interface DocumentRecord {
  documentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  status: DocumentProcessingStatus;
  readiness: DocumentReadinessPayload;
}

const globalForRegistry = globalThis as typeof globalThis & {
  __docAgentDocumentRegistry?: Map<string, DocumentRecord>;
};

const registry = globalForRegistry.__docAgentDocumentRegistry ?? new Map<string, DocumentRecord>();
globalForRegistry.__docAgentDocumentRegistry = registry;

export function upsertDocumentRecord(record: DocumentRecord): void {
  registry.set(record.documentId, record);
}

export function getDocumentRecord(documentId: string): DocumentRecord | undefined {
  return registry.get(documentId);
}

export function listDocumentRecords(): DocumentRecord[] {
  return Array.from(registry.values()).sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  );
}

export function deleteDocumentRecord(documentId: string): boolean {
  return registry.delete(documentId);
}

export function hasDocumentRecord(documentId: string): boolean {
  return registry.has(documentId);
}
