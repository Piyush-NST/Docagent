/**
 * Document chunk indexing + hybrid retrieval over the persistent store.
 */

import { DocumentChunk } from './document-processor';
import { cosineSimilarity, generateEmbedding, generateQueryEmbedding } from './gemini';
import { EMBEDDING_MODEL } from './config/readiness';
import { RETRIEVAL_CONFIG, type RetrievalMode } from './config/retrieval';
import { dedupeByContent, diversifyByDocument, hybridScore, lexicalScore, tokenize } from './retrieval';
import { getStore } from './store';
import type { PersistedChunk } from './store/types';

export interface SearchResult {
  id: string;
  documentId: string;
  content: string;
  page?: number;
  section?: string;
  relevance: number;
  metadata: {
    fileName: string;
    fileType: string;
    extractedAt: string;
  };
}

export interface SearchOutcome {
  results: SearchResult[];
  retrievalMode: RetrievalMode;
}

function toSearchResult(chunk: PersistedChunk, relevance: number): SearchResult {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    content: chunk.content,
    page: chunk.page,
    section: chunk.section,
    relevance,
    metadata: {
      fileName: chunk.fileName,
      fileType: chunk.fileType,
      extractedAt: chunk.extractedAt,
    },
  };
}

export async function storeDocumentChunks(
  documentId: string,
  chunks: DocumentChunk[],
): Promise<{ embeddingsCreated: number; retrievalMode: RetrievalMode }> {
  console.log(`Indexing ${chunks.length} chunks for doc ${documentId}`);
  const store = getStore();
  const persisted: PersistedChunk[] = [];
  let embeddingsCreated = 0;
  let anyEmbeddingFailed = false;

  for (const chunk of chunks) {
    const embedded = await generateEmbedding(chunk.content);
    if (embedded?.embedding?.length) {
      embeddingsCreated += 1;
    } else {
      anyEmbeddingFailed = true;
    }

    persisted.push({
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      page: chunk.page,
      section: chunk.section,
      chunkIndex: chunk.chunkIndex,
      embedding: embedded?.embedding ?? null,
      embeddingModel: embedded?.model ?? null,
      fileName: chunk.metadata.fileName,
      fileType: chunk.metadata.fileType,
      extractedAt: chunk.metadata.extractedAt,
      lexicalText: tokenize(chunk.content).join(' '),
    });
  }

  await store.replaceChunks(documentId, persisted);
  console.log(`Persisted ${persisted.length} chunks (${embeddingsCreated} embeddings)`);

  return {
    embeddingsCreated,
    retrievalMode: anyEmbeddingFailed || embeddingsCreated === 0 ? 'lexical_only' : 'hybrid',
  };
}

async function rankChunks(
  chunks: PersistedChunk[],
  query: string,
  topK: number,
  options?: { diversifyDocumentIds?: string[] },
): Promise<SearchOutcome> {
  if (!chunks.length) return { results: [], retrievalMode: 'lexical_only' };

  const queryEmbedding = await generateQueryEmbedding(query);
  const compatibleModel = queryEmbedding && !queryEmbedding.degraded ? EMBEDDING_MODEL : null;
  const canUseSemantic = Boolean(
    queryEmbedding?.embedding?.length &&
      chunks.some(
        (c) =>
          c.embedding &&
          c.embedding.length === queryEmbedding!.embedding.length &&
          (c.embeddingModel === compatibleModel || c.embeddingModel === 'mock-embedding'),
      ),
  );

  const retrievalMode: RetrievalMode = canUseSemantic ? 'hybrid' : 'lexical_only';
  if (retrievalMode === 'lexical_only') {
    console.log('[Retrieval] Semantic unavailable — using lexical-only ranking');
  }

  const scored = chunks.map((chunk) => {
    const lexical = lexicalScore(query, chunk.content);
    let semantic = 0;
    if (
      canUseSemantic &&
      queryEmbedding &&
      chunk.embedding &&
      chunk.embedding.length === queryEmbedding.embedding.length
    ) {
      semantic = cosineSimilarity(queryEmbedding.embedding, chunk.embedding);
    }
    const relevance = canUseSemantic ? hybridScore(semantic, lexical) : lexical;
    return toSearchResult(chunk, relevance);
  });

  scored.sort((a, b) => b.relevance - a.relevance);

  const minScore =
    retrievalMode === 'hybrid'
      ? RETRIEVAL_CONFIG.minHybridRelevance
      : RETRIEVAL_CONFIG.minLexicalFallback;

  const filtered = scored.filter((item) => item.relevance >= minScore);
  const pool = filtered.length > 0 ? filtered : scored.slice(0, Math.min(topK, scored.length));
  let results = dedupeByContent(pool);

  if (options?.diversifyDocumentIds && options.diversifyDocumentIds.length > 1) {
    results = diversifyByDocument(results, options.diversifyDocumentIds, topK);
  } else {
    results = results.slice(0, topK);
  }

  return { results, retrievalMode };
}

export async function searchDocument(
  documentId: string,
  query: string,
  topK: number = RETRIEVAL_CONFIG.defaultTopK,
): Promise<SearchOutcome> {
  const chunks = await getStore().getChunks(documentId);
  if (!chunks.length) {
    console.log(`No chunks found for doc ${documentId}`);
    return { results: [], retrievalMode: 'lexical_only' };
  }
  return rankChunks(chunks, query, topK);
}

export async function searchDocuments(
  documentIds: string[],
  query: string,
  topK: number = RETRIEVAL_CONFIG.multiDocTopK,
  options?: { diversify?: boolean },
): Promise<SearchOutcome> {
  const chunks = await getStore().getChunksForDocuments(documentIds);
  if (!chunks.length) return { results: [], retrievalMode: 'lexical_only' };
  return rankChunks(chunks, query, topK, {
    diversifyDocumentIds: options?.diversify ? documentIds : undefined,
  });
}

export async function getDocumentChunks(documentId: string): Promise<PersistedChunk[]> {
  return getStore().getChunks(documentId);
}

export async function hasDocument(documentId: string): Promise<boolean> {
  const doc = await getStore().getDocument(documentId);
  if (doc) return true;
  const chunks = await getStore().getChunks(documentId);
  return chunks.length > 0;
}

export async function deleteDocumentFromStore(documentId: string): Promise<boolean> {
  return getStore().deleteDocument(documentId);
}

export async function getStoreStats(): Promise<{
  totalDocuments: number;
  totalChunks: number;
  documents: Array<{ documentId: string; chunkCount: number; fileName: string }>;
  backend: string;
}> {
  const store = getStore();
  const docs = await store.listDocuments();
  let totalChunks = 0;
  const documents = [];

  for (const doc of docs) {
    totalChunks += doc.chunkCount;
    documents.push({
      documentId: doc.documentId,
      chunkCount: doc.chunkCount,
      fileName: doc.fileName,
    });
  }

  return {
    totalDocuments: docs.length,
    totalChunks,
    documents,
    backend: store.backend,
  };
}
