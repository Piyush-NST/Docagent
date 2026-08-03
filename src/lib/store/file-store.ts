import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DocAgentStore, PersistedChunk, PersistedDocument, StorageBackend } from './types';

const DATA_ROOT = path.join(process.cwd(), '.data');
const DOCS_DIR = path.join(DATA_ROOT, 'documents');
const CHUNKS_DIR = path.join(DATA_ROOT, 'chunks');

async function ensureDirs(): Promise<void> {
  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.mkdir(CHUNKS_DIR, { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDirs();
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

export class FileStore implements DocAgentStore {
  readonly backend: StorageBackend = 'file';

  private docPath(id: string) {
    return path.join(DOCS_DIR, `${id}.json`);
  }

  private chunkPath(id: string) {
    return path.join(CHUNKS_DIR, `${id}.json`);
  }

  async upsertDocument(doc: PersistedDocument): Promise<void> {
    await writeJson(this.docPath(doc.documentId), doc);
  }

  async getDocument(documentId: string): Promise<PersistedDocument | null> {
    return readJson<PersistedDocument>(this.docPath(documentId));
  }

  async listDocuments(): Promise<PersistedDocument[]> {
    await ensureDirs();
    const files = await fs.readdir(DOCS_DIR);
    const docs: PersistedDocument[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const doc = await readJson<PersistedDocument>(path.join(DOCS_DIR, file));
      if (doc) docs.push(doc);
    }
    return docs.sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
  }

  async findDocumentByHash(contentHash: string): Promise<PersistedDocument | null> {
    const docs = await this.listDocuments();
    return docs.find((d) => d.contentHash === contentHash) || null;
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    await this.deleteChunks(documentId);
    try {
      await fs.unlink(this.docPath(documentId));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async replaceChunks(documentId: string, chunks: PersistedChunk[]): Promise<void> {
    await writeJson(this.chunkPath(documentId), chunks);
  }

  async getChunks(documentId: string): Promise<PersistedChunk[]> {
    return (await readJson<PersistedChunk[]>(this.chunkPath(documentId))) || [];
  }

  async getChunksForDocuments(documentIds: string[]): Promise<PersistedChunk[]> {
    const out: PersistedChunk[] = [];
    for (const id of documentIds) out.push(...(await this.getChunks(id)));
    return out;
  }

  async deleteChunks(documentId: string): Promise<void> {
    try {
      await fs.unlink(this.chunkPath(documentId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
