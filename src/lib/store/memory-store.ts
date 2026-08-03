import type { DocAgentStore, PersistedChunk, PersistedDocument, StorageBackend } from './types';

const globalForMemory = globalThis as typeof globalThis & {
  __docAgentMemoryDocs?: Map<string, PersistedDocument>;
  __docAgentMemoryChunks?: Map<string, PersistedChunk[]>;
};

export class MemoryStore implements DocAgentStore {
  readonly backend: StorageBackend = 'memory';
  private docs: Map<string, PersistedDocument>;
  private chunks: Map<string, PersistedChunk[]>;

  constructor() {
    this.docs = globalForMemory.__docAgentMemoryDocs ?? new Map();
    this.chunks = globalForMemory.__docAgentMemoryChunks ?? new Map();
    globalForMemory.__docAgentMemoryDocs = this.docs;
    globalForMemory.__docAgentMemoryChunks = this.chunks;
  }

  async upsertDocument(doc: PersistedDocument): Promise<void> {
    this.docs.set(doc.documentId, doc);
  }

  async getDocument(documentId: string): Promise<PersistedDocument | null> {
    return this.docs.get(documentId) || null;
  }

  async listDocuments(): Promise<PersistedDocument[]> {
    return Array.from(this.docs.values()).sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
  }

  async findDocumentByHash(contentHash: string): Promise<PersistedDocument | null> {
    for (const doc of this.docs.values()) {
      if (doc.contentHash && doc.contentHash === contentHash) return doc;
    }
    return null;
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    this.chunks.delete(documentId);
    return this.docs.delete(documentId);
  }

  async replaceChunks(documentId: string, chunks: PersistedChunk[]): Promise<void> {
    this.chunks.set(documentId, chunks);
  }

  async getChunks(documentId: string): Promise<PersistedChunk[]> {
    return this.chunks.get(documentId) || [];
  }

  async getChunksForDocuments(documentIds: string[]): Promise<PersistedChunk[]> {
    const out: PersistedChunk[] = [];
    for (const id of documentIds) out.push(...(await this.getChunks(id)));
    return out;
  }

  async deleteChunks(documentId: string): Promise<void> {
    this.chunks.delete(documentId);
  }

  /** Test helper: wipe process memory */
  clearAll(): void {
    this.docs.clear();
    this.chunks.clear();
  }
}
