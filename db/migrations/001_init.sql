-- DocAgent persistent schema (Postgres / Neon)
-- Applied automatically on first PostgresStore use; kept here for explicit setup.

CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content_hash TEXT,
  blob_url TEXT,
  blob_access TEXT,
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
