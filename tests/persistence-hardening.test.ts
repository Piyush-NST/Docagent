import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { MemoryStore } from '../src/lib/store/memory-store';
import { resetStoreForTests } from '../src/lib/store';
import { buildReadyReadiness, isDocumentQueryable } from '../src/lib/document-status';
import { cosineSimilarity } from '../src/lib/gemini';
import { diversifyByDocument, hybridScore, lexicalScore } from '../src/lib/retrieval';
import { READINESS_THRESHOLDS } from '../src/lib/config/readiness';
import { RETRIEVAL_CONFIG } from '../src/lib/config/retrieval';

describe('persistent store (memory backend simulation)', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
    store.clearAll();
    resetStoreForTests(store);
  });

  it('persists document metadata and survives registry reconstruction', async () => {
    const readiness = buildReadyReadiness({
      fileSize: 100,
      textLength: 500,
      chunksCreated: 2,
      embeddingsCreated: 2,
      ocrUsed: false,
      pages: 2,
      pageStats: {
        totalPages: 2,
        processedPages: 2,
        nativeTextPages: 2,
        ocrPages: 0,
        ocrFailedPages: 0,
        ocrSkippedPages: 0,
        failedPages: 0,
        warnings: [],
      },
    });

    await store.upsertDocument({
      documentId: 'doc-1',
      fileName: 'a.pdf',
      fileType: 'application/pdf',
      fileSize: 100,
      contentHash: 'abc',
      uploadedAt: new Date().toISOString(),
      status: readiness.status,
      readiness,
      chunkCount: 2,
      pages: 2,
      processedPages: 2,
    });

    // Simulate another serverless instance: new MemoryStore sharing global maps
    const other = new MemoryStore();
    const found = await other.getDocument('doc-1');
    assert.ok(found);
    assert.equal(found.fileName, 'a.pdf');
    assert.equal(found.contentHash, 'abc');

    const byHash = await other.findDocumentByHash('abc');
    assert.equal(byHash?.documentId, 'doc-1');
  });

  it('persists chunk metadata including page numbers', async () => {
    await store.replaceChunks('doc-1', [
      {
        id: 'c1',
        documentId: 'doc-1',
        content: 'Net income was eighteen crore.',
        page: 3,
        section: 'Financials',
        chunkIndex: 0,
        embedding: [0.1, 0.2, 0.3],
        embeddingModel: 'gemini-embedding-001',
        fileName: 'a.pdf',
        fileType: 'application/pdf',
        extractedAt: new Date().toISOString(),
        lexicalText: 'net income was eighteen crore',
      },
    ]);

    const chunks = await store.getChunks('doc-1');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].page, 3);
    assert.equal(chunks[0].section, 'Financials');
    assert.ok(chunks[0].embedding);
  });

  it('cascades delete of document and chunks', async () => {
    await store.upsertDocument({
      documentId: 'doc-x',
      fileName: 'x.pdf',
      fileType: 'application/pdf',
      fileSize: 10,
      uploadedAt: new Date().toISOString(),
      status: 'ready',
      readiness: buildReadyReadiness({
        fileSize: 10,
        textLength: 200,
        chunksCreated: 1,
        embeddingsCreated: 1,
        ocrUsed: false,
      }),
      chunkCount: 1,
    });
    await store.replaceChunks('doc-x', [
      {
        id: 'cx',
        documentId: 'doc-x',
        content: 'hello world content enough',
        chunkIndex: 0,
        embedding: null,
        embeddingModel: null,
        fileName: 'x.pdf',
        fileType: 'application/pdf',
        extractedAt: new Date().toISOString(),
        lexicalText: 'hello world',
      },
    ]);

    await store.deleteDocument('doc-x');
    assert.equal(await store.getDocument('doc-x'), null);
    assert.equal((await store.getChunks('doc-x')).length, 0);
  });
});

describe('readiness limited vs ready', () => {
  it('marks limited for low page coverage', () => {
    const readiness = buildReadyReadiness({
      fileSize: 10,
      textLength: 800,
      chunksCreated: 3,
      embeddingsCreated: 3,
      ocrUsed: true,
      pageStats: {
        totalPages: 100,
        processedPages: 17,
        nativeTextPages: 0,
        ocrPages: 17,
        ocrFailedPages: 5,
        ocrSkippedPages: 78,
        failedPages: 83,
        warnings: [],
      },
    });
    assert.equal(readiness.status, 'limited');
    assert.equal(isDocumentQueryable('limited'), true);
    assert.ok((readiness.pageCoveragePercent || 0) < READINESS_THRESHOLDS.warningMinPageCoverage * 100);
    assert.ok(readiness.userMessage?.toLowerCase().includes('limited'));
  });

  it('marks ready for high coverage', () => {
    const readiness = buildReadyReadiness({
      fileSize: 10,
      textLength: 1200,
      chunksCreated: 5,
      embeddingsCreated: 5,
      ocrUsed: false,
      pageStats: {
        totalPages: 10,
        processedPages: 10,
        nativeTextPages: 10,
        ocrPages: 0,
        ocrFailedPages: 0,
        ocrSkippedPages: 0,
        failedPages: 0,
        warnings: [],
      },
    });
    assert.equal(readiness.status, 'ready');
  });

  it('distinguishes OCR skipped in page stats', () => {
    const readiness = buildReadyReadiness({
      fileSize: 10,
      textLength: 500,
      chunksCreated: 2,
      embeddingsCreated: 2,
      ocrUsed: true,
      pageStats: {
        totalPages: 20,
        processedPages: 12,
        nativeTextPages: 10,
        ocrPages: 2,
        ocrFailedPages: 1,
        ocrSkippedPages: 7,
        failedPages: 8,
        warnings: [],
      },
    });
    assert.ok(readiness.warnings?.some((w) => w.toLowerCase().includes('skipped')));
    assert.ok(readiness.warnings?.some((w) => w.toLowerCase().includes('failed ocr')));
  });
});

describe('retrieval math', () => {
  it('handles zero / mismatched vectors safely', () => {
    assert.equal(cosineSimilarity([], [1, 2]), 0);
    assert.equal(cosineSimilarity([1, 0], [0, 1, 0]), 0);
    assert.equal(cosineSimilarity([0, 0], [0, 0]), 0);
    assert.ok(cosineSimilarity([1, 0], [1, 0]) > 0.99);
  });

  it('hybrid blend uses centralized weights', () => {
    const score = hybridScore(1, 0);
    assert.equal(score, RETRIEVAL_CONFIG.semanticWeight);
  });

  it('diversifies compare evidence across documents', () => {
    const items = [
      { documentId: 'a', relevance: 0.9 },
      { documentId: 'a', relevance: 0.8 },
      { documentId: 'a', relevance: 0.7 },
      { documentId: 'b', relevance: 0.6 },
      { documentId: 'b', relevance: 0.5 },
    ];
    const selected = diversifyByDocument(items, ['a', 'b'], 4, 2);
    assert.ok(selected.some((s) => s.documentId === 'a'));
    assert.ok(selected.some((s) => s.documentId === 'b'));
    assert.equal(selected.length, 4);
  });

  it('lexical score still works for exact overlap', () => {
    assert.ok(lexicalScore('net income', 'The company reported net income growth') > 0.4);
  });
});
