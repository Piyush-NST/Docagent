// stores document chunks in memory for searching

import { cosineSimilarity, generateEmbedding } from './azure-openai';
import { DocumentChunk } from './document-processor';

export interface StoredChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  page?: number;
  section?: string;
  metadata: {
    fileName: string;
    fileType: string;
    extractedAt: string;
  };
}

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

const vectorStore: Map<string, StoredChunk[]> = new Map();

export async function storeDocumentChunks(
  documentId: string,
  chunks: DocumentChunk[]
): Promise<void> {
  console.log(`Storing ${chunks.length} chunks for doc ${documentId}`);
  
  const storedChunks: StoredChunk[] = [];

  for (const chunk of chunks) {
    try {
      const embedding = await generateEmbedding(chunk.content);
      
      storedChunks.push({
        id: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        embedding,
        page: chunk.page,
        section: chunk.section,
        metadata: chunk.metadata,
      });
    } catch (err) {
      console.error(`Failed to embed chunk ${chunk.id}:`, err);
    }
  }

  vectorStore.set(documentId, storedChunks);
  console.log(`Stored ${storedChunks.length} embeddings`);
}

// finds relevant chunks for a question
export async function searchDocument(
  documentId: string,
  query: string,
  topK: number = 5,
  minRelevance: number = 0.1
): Promise<SearchResult[]> {
  const chunks = vectorStore.get(documentId);
  
  if (!chunks || chunks.length === 0) {
    console.log(`No chunks found for doc ${documentId}`);
    return [];
  }

  // small docs just return everything
  if (chunks.length <= topK) {
    console.log(`Returning all ${chunks.length} chunks (small document)`);
    return chunks.map(chunk => ({
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      page: chunk.page,
      section: chunk.section,
      relevance: 0.9,
      metadata: chunk.metadata,
    }));
  }

  // bigger docs do similarity search
  const queryEmbedding = await generateEmbedding(query);
  const results: SearchResult[] = [];
  
  for (const chunk of chunks) {
    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
    
    results.push({
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      page: chunk.page,
      section: chunk.section,
      relevance: similarity,
      metadata: chunk.metadata,
    });
  }

  results.sort((a, b) => b.relevance - a.relevance);
  
  const topResults = results.slice(0, topK);
  
  if (topResults.length > 0 && topResults[0].relevance < minRelevance) {
    console.log(`Low similarity scores, returning top ${topK} chunks anyway`);
  }
  
  console.log(`Found ${topResults.length} relevant chunks`);
  return topResults;
}

export async function searchAllDocuments(
  query: string,
  topK: number = 5,
  minRelevance: number = 0.1
): Promise<SearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);
  const allResults: SearchResult[] = [];

  for (const [docId, chunks] of vectorStore.entries()) {
    for (const chunk of chunks) {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
      
      allResults.push({
        id: chunk.id,
        documentId: docId,
        content: chunk.content,
        page: chunk.page,
        section: chunk.section,
        relevance: similarity,
        metadata: chunk.metadata,
      });
    }
  }

  allResults.sort((a, b) => b.relevance - a.relevance);
  return allResults.slice(0, topK);
}

export function getDocumentChunks(documentId: string): StoredChunk[] {
  return vectorStore.get(documentId) || [];
}

export function hasDocument(documentId: string): boolean {
  return vectorStore.has(documentId);
}

export function deleteDocumentFromStore(documentId: string): boolean {
  const deleted = vectorStore.delete(documentId);
  if (deleted) console.log(`Deleted doc ${documentId}`);
  return deleted;
}

export function getAllDocumentIds(): string[] {
  return Array.from(vectorStore.keys());
}

export function getStoreStats(): {
  totalDocuments: number;
  totalChunks: number;
  documents: Array<{ documentId: string; chunkCount: number; fileName: string }>;
} {
  const docs: Array<{ documentId: string; chunkCount: number; fileName: string }> = [];
  let totalChunks = 0;

  for (const [docId, chunks] of vectorStore.entries()) {
    totalChunks += chunks.length;
    docs.push({
      documentId: docId,
      chunkCount: chunks.length,
      fileName: chunks[0]?.metadata.fileName || 'Unknown',
    });
  }

  return { totalDocuments: vectorStore.size, totalChunks, documents: docs };
}
