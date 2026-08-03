import postgres from 'postgres';
import type { DocAgentStore, PersistedChunk, PersistedDocument, StorageBackend } from './types';
import { PersistenceUnavailableError } from './types';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content_hash TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  pages INTEGER,
  processed_pages INTEGER,
  native_text_pages INTEGER,
  ocr_pages INTEGER,
  ocr_failed_pages INTEGER,
  ocr_skipped_pages INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  readiness JSONB NOT NULL,
  warnings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS documents_content_hash_uidx
  ON documents (content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page INTEGER,
  section TEXT,
  chunk_index INTEGER NOT NULL,
  embedding JSONB,
  embedding_model TEXT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  extracted_at TIMESTAMPTZ NOT NULL,
  lexical_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks (document_id);
`;

type Sql = ReturnType<typeof postgres>;

const globalForPg = globalThis as typeof globalThis & {
  __docAgentSql?: Sql;
  __docAgentSchemaReady?: Promise<void>;
};

function getSql(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new PersistenceUnavailableError(
      'DATABASE_URL is not configured. Set a Postgres connection string for persistent document storage.',
    );
  }

  if (!globalForPg.__docAgentSql) {
    globalForPg.__docAgentSql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }

  return globalForPg.__docAgentSql;
}

async function ensureSchema(sql: Sql): Promise<void> {
  if (!globalForPg.__docAgentSchemaReady) {
    globalForPg.__docAgentSchemaReady = (async () => {
      await sql.unsafe(SCHEMA_SQL);
    })();
  }
  await globalForPg.__docAgentSchemaReady;
}

function rowToDocument(row: Record<string, unknown>): PersistedDocument {
  return {
    documentId: String(row.document_id),
    fileName: String(row.file_name),
    fileType: String(row.file_type),
    fileSize: Number(row.file_size),
    contentHash: row.content_hash ? String(row.content_hash) : undefined,
    uploadedAt: new Date(String(row.uploaded_at)).toISOString(),
    status: row.status as PersistedDocument['status'],
    readiness: row.readiness as PersistedDocument['readiness'],
    pages: row.pages == null ? undefined : Number(row.pages),
    processedPages: row.processed_pages == null ? undefined : Number(row.processed_pages),
    nativeTextPages: row.native_text_pages == null ? undefined : Number(row.native_text_pages),
    ocrPages: row.ocr_pages == null ? undefined : Number(row.ocr_pages),
    ocrFailedPages: row.ocr_failed_pages == null ? undefined : Number(row.ocr_failed_pages),
    ocrSkippedPages: row.ocr_skipped_pages == null ? undefined : Number(row.ocr_skipped_pages),
    chunkCount: Number(row.chunk_count || 0),
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : undefined,
  };
}

function rowToChunk(row: Record<string, unknown>): PersistedChunk {
  const embedding = row.embedding;
  return {
    id: String(row.chunk_id),
    documentId: String(row.document_id),
    content: String(row.content),
    page: row.page == null ? undefined : Number(row.page),
    section: row.section == null ? undefined : String(row.section),
    chunkIndex: Number(row.chunk_index),
    embedding: Array.isArray(embedding) ? (embedding as number[]) : null,
    embeddingModel: row.embedding_model == null ? null : String(row.embedding_model),
    fileName: String(row.file_name),
    fileType: String(row.file_type),
    extractedAt: new Date(String(row.extracted_at)).toISOString(),
    lexicalText: String(row.lexical_text || ''),
  };
}

export class PostgresStore implements DocAgentStore {
  readonly backend: StorageBackend = 'postgres';

  private async db(): Promise<Sql> {
    const sql = getSql();
    await ensureSchema(sql);
    return sql;
  }

  async upsertDocument(doc: PersistedDocument): Promise<void> {
    const sql = await this.db();
    await sql`
      INSERT INTO documents (
        document_id, file_name, file_type, file_size, content_hash, uploaded_at, status,
        pages, processed_pages, native_text_pages, ocr_pages, ocr_failed_pages, ocr_skipped_pages,
        chunk_count, readiness, warnings
      ) VALUES (
        ${doc.documentId}, ${doc.fileName}, ${doc.fileType}, ${doc.fileSize}, ${doc.contentHash || null},
        ${doc.uploadedAt}, ${doc.status}, ${doc.pages ?? null}, ${doc.processedPages ?? null},
        ${doc.nativeTextPages ?? null}, ${doc.ocrPages ?? null}, ${doc.ocrFailedPages ?? null},
        ${doc.ocrSkippedPages ?? null}, ${doc.chunkCount}, ${sql.json(doc.readiness as never)},
        ${doc.warnings ? sql.json(doc.warnings as never) : null}
      )
      ON CONFLICT (document_id) DO UPDATE SET
        file_name = EXCLUDED.file_name,
        file_type = EXCLUDED.file_type,
        file_size = EXCLUDED.file_size,
        content_hash = EXCLUDED.content_hash,
        uploaded_at = EXCLUDED.uploaded_at,
        status = EXCLUDED.status,
        pages = EXCLUDED.pages,
        processed_pages = EXCLUDED.processed_pages,
        native_text_pages = EXCLUDED.native_text_pages,
        ocr_pages = EXCLUDED.ocr_pages,
        ocr_failed_pages = EXCLUDED.ocr_failed_pages,
        ocr_skipped_pages = EXCLUDED.ocr_skipped_pages,
        chunk_count = EXCLUDED.chunk_count,
        readiness = EXCLUDED.readiness,
        warnings = EXCLUDED.warnings
    `;
  }

  async getDocument(documentId: string): Promise<PersistedDocument | null> {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM documents WHERE document_id = ${documentId} LIMIT 1`;
    if (!rows[0]) return null;
    return rowToDocument(rows[0] as Record<string, unknown>);
  }

  async listDocuments(): Promise<PersistedDocument[]> {
    const sql = await this.db();
    const rows = await sql`SELECT * FROM documents ORDER BY uploaded_at DESC`;
    return rows.map((row) => rowToDocument(row as Record<string, unknown>));
  }

  async findDocumentByHash(contentHash: string): Promise<PersistedDocument | null> {
    const sql = await this.db();
    const rows = await sql`
      SELECT * FROM documents WHERE content_hash = ${contentHash} LIMIT 1
    `;
    if (!rows[0]) return null;
    return rowToDocument(rows[0] as Record<string, unknown>);
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    const sql = await this.db();
    const rows = await sql`
      DELETE FROM documents WHERE document_id = ${documentId} RETURNING document_id
    `;
    return rows.length > 0;
  }

  async replaceChunks(documentId: string, chunks: PersistedChunk[]): Promise<void> {
    const sql = await this.db();
    await sql.begin(async (tx) => {
      await tx`DELETE FROM chunks WHERE document_id = ${documentId}`;
      for (const chunk of chunks) {
        await tx`
          INSERT INTO chunks (
            chunk_id, document_id, content, page, section, chunk_index,
            embedding, embedding_model, file_name, file_type, extracted_at, lexical_text
          ) VALUES (
            ${chunk.id}, ${chunk.documentId}, ${chunk.content}, ${chunk.page ?? null},
            ${chunk.section ?? null}, ${chunk.chunkIndex},
            ${chunk.embedding ? tx.json(chunk.embedding as never) : null},
            ${chunk.embeddingModel}, ${chunk.fileName}, ${chunk.fileType},
            ${chunk.extractedAt}, ${chunk.lexicalText}
          )
        `;
      }
    });
  }

  async getChunks(documentId: string): Promise<PersistedChunk[]> {
    const sql = await this.db();
    const rows = await sql`
      SELECT * FROM chunks WHERE document_id = ${documentId} ORDER BY chunk_index ASC
    `;
    return rows.map((row) => rowToChunk(row as Record<string, unknown>));
  }

  async getChunksForDocuments(documentIds: string[]): Promise<PersistedChunk[]> {
    if (documentIds.length === 0) return [];
    const sql = await this.db();
    const rows = await sql`
      SELECT * FROM chunks WHERE document_id = ANY(${documentIds}) ORDER BY document_id, chunk_index ASC
    `;
    return rows.map((row) => rowToChunk(row as Record<string, unknown>));
  }

  async deleteChunks(documentId: string): Promise<void> {
    const sql = await this.db();
    await sql`DELETE FROM chunks WHERE document_id = ${documentId}`;
  }
}
