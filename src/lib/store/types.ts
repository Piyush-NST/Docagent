import type { DocumentReadinessPayload, DocumentProcessingStatus } from '@/lib/document-status';

export interface PersistedDocument {
  documentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  contentHash?: string;
  blobUrl?: string;
  blobAccess?: 'private' | 'public';
  uploadedAt: string;
  status: DocumentProcessingStatus;
  readiness: DocumentReadinessPayload;
  pages?: number;
  processedPages?: number;
  nativeTextPages?: number;
  ocrPages?: number;
  ocrFailedPages?: number;
  ocrSkippedPages?: number;
  chunkCount: number;
  warnings?: string[];
  indexVersion?: number;
}

export interface PersistedChunk {
  id: string;
  documentId: string;
  content: string;
  page?: number;
  section?: string;
  chunkIndex: number;
  embedding: number[] | null;
  embeddingModel: string | null;
  fileName: string;
  fileType: string;
  extractedAt: string;
  lexicalText: string;
}

export type StorageBackend = 'postgres' | 'file' | 'memory';

export class PersistenceUnavailableError extends Error {
  status = 503;
  code = 'PERSISTENCE_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'PersistenceUnavailableError';
  }
}

export interface DocAgentStore {
  readonly backend: StorageBackend;

  upsertDocument(doc: PersistedDocument): Promise<void>;
  getDocument(documentId: string): Promise<PersistedDocument | null>;
  listDocuments(): Promise<PersistedDocument[]>;
  findDocumentByHash(contentHash: string): Promise<PersistedDocument | null>;
  deleteDocument(documentId: string): Promise<boolean>;

  replaceChunks(documentId: string, chunks: PersistedChunk[]): Promise<void>;
  getChunks(documentId: string): Promise<PersistedChunk[]>;
  getChunksForDocuments(documentIds: string[]): Promise<PersistedChunk[]>;
  deleteChunks(documentId: string): Promise<void>;
}
