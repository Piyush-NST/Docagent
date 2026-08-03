/**
 * Centralized retrieval scoring configuration.
 * Hybrid = semantic * SEMANTIC_WEIGHT + lexical * LEXICAL_WEIGHT
 */
export const RETRIEVAL_CONFIG = {
  semanticWeight: 0.65,
  lexicalWeight: 0.35,
  defaultTopK: 5,
  summarizeTopK: 8,
  compareTopK: 8,
  multiDocTopK: 6,
  minHybridRelevance: 0.08,
  /** Soft floor when all scores are weak — still return something for small corpora */
  minLexicalFallback: 0.12,
  dedupeOverlapThreshold: 0.92,
  /** For COMPARE mode: try to keep at least this many chunks per selected doc when available */
  compareMinPerDocument: 2,
  embeddingBatchSize: 16,
} as const;

export type RetrievalMode = 'hybrid' | 'lexical_only';
