/**
 * Hybrid retrieval: Gemini semantic cosine + lexical token overlap.
 */

import { RETRIEVAL_CONFIG, type RetrievalMode } from '@/lib/config/retrieval';

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

export function lexicalScore(query: string, content: string): number {
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;

  const cTokens = new Set(tokenize(content));
  let hits = 0;
  for (const token of qTokens) {
    if (cTokens.has(token)) hits += 1;
  }
  return hits / qTokens.length;
}

export function hybridScore(semantic: number, lexical: number): number {
  return (
    semantic * RETRIEVAL_CONFIG.semanticWeight + lexical * RETRIEVAL_CONFIG.lexicalWeight
  );
}

export function contentFingerprint(text: string): string {
  return tokenize(text).slice(0, 40).join(' ');
}

export function dedupeByContent<T extends { content: string; relevance: number }>(
  items: T[],
  threshold = RETRIEVAL_CONFIG.dedupeOverlapThreshold,
): T[] {
  const kept: T[] = [];
  const fingerprints: string[] = [];

  for (const item of items) {
    const fp = contentFingerprint(item.content);
    const isDup = fingerprints.some((existing) => {
      if (!existing || !fp) return false;
      if (existing === fp) return true;
      const a = new Set(existing.split(' '));
      const b = fp.split(' ');
      let overlap = 0;
      for (const token of b) if (a.has(token)) overlap += 1;
      return b.length > 0 && overlap / b.length >= threshold;
    });

    if (!isDup) {
      kept.push(item);
      fingerprints.push(fp);
    }
  }

  return kept;
}

/**
 * For COMPARE mode: ensure evidence diversity across documents when possible.
 */
export function diversifyByDocument<T extends { documentId: string; relevance: number }>(
  items: T[],
  documentIds: string[],
  topK: number,
  minPerDoc = RETRIEVAL_CONFIG.compareMinPerDocument,
): T[] {
  if (documentIds.length < 2) return items.slice(0, topK);

  const byDoc = new Map<string, T[]>();
  for (const id of documentIds) byDoc.set(id, []);
  for (const item of items) {
    const list = byDoc.get(item.documentId);
    if (list) list.push(item);
  }

  const selected: T[] = [];
  const selectedSet = new Set<T>();

  for (const id of documentIds) {
    for (const item of (byDoc.get(id) || []).slice(0, minPerDoc)) {
      if (selectedSet.has(item)) continue;
      selected.push(item);
      selectedSet.add(item);
      if (selected.length >= topK) return selected;
    }
  }

  for (const item of items) {
    if (selectedSet.has(item)) continue;
    selected.push(item);
    selectedSet.add(item);
    if (selected.length >= topK) break;
  }

  return selected.slice(0, topK);
}

export function describeRetrievalMode(mode: RetrievalMode): string {
  return mode === 'hybrid' ? 'Hybrid (semantic + lexical)' : 'Lexical fallback';
}
