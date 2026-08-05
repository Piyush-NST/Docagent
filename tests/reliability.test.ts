import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMeaningfulExtractedText } from '../src/lib/text-validation';
import {
  buildFailedOcrReadiness,
  buildIndexingReadiness,
  buildReadyReadiness,
  computeReadinessCoverage,
  isDocumentQueryable,
} from '../src/lib/document-status';
import { chunkPageBlocks, chunkText } from '../src/lib/document-processor';
import { validateUploadFile } from '../src/lib/file-validation';
import { dedupeByContent, hybridScore, lexicalScore } from '../src/lib/retrieval';
import { hashFileBuffer } from '../src/lib/file-hash';
import { MemoryStore } from '../src/lib/store/memory-store';
import { resetStoreForTests } from '../src/lib/store';
import { searchDocument } from '../src/lib/vector-store';
import { resolvePostgresUrl } from '../src/lib/config/database';

describe('production database configuration', () => {
  it('accepts standard Neon and Vercel Postgres environment names', () => {
    assert.equal(resolvePostgresUrl({ DATABASE_URL: 'postgres://database' }), 'postgres://database');
    assert.equal(resolvePostgresUrl({ POSTGRES_URL: 'postgres://vercel' }), 'postgres://vercel');
    assert.equal(
      resolvePostgresUrl({ POSTGRES_PRISMA_URL: 'postgres://prisma' }),
      'postgres://prisma',
    );
  });

  it('prefers DATABASE_URL when multiple connection variables exist', () => {
    assert.equal(
      resolvePostgresUrl({ DATABASE_URL: 'postgres://primary', POSTGRES_URL: 'postgres://fallback' }),
      'postgres://primary',
    );
  });
});

describe('parent-first document indexing', () => {
  it('creates a non-queryable parent readiness record before chunks are persisted', () => {
    const readiness = buildIndexingReadiness({
      fileSize: 2048,
      textLength: 480,
      ocrUsed: false,
    });

    assert.equal(readiness.status, 'processing');
    assert.equal(readiness.chunksCreated, 0);
    assert.equal(readiness.embeddingsCreated, 0);
    assert.equal(readiness.grounded, false);
    assert.equal(isDocumentQueryable(readiness.status), false);
  });
});

describe('isMeaningfulExtractedText', () => {
  it('rejects empty / whitespace / OCR failures', () => {
    assert.equal(isMeaningfulExtractedText('').ok, false);
    assert.equal(isMeaningfulExtractedText('   ').ok, false);
    assert.equal(isMeaningfulExtractedText('NO_READABLE_TEXT').ok, false);
    assert.equal(isMeaningfulExtractedText('Could not extract text from image').ok, false);
    assert.equal(isMeaningfulExtractedText('????????????').ok, false);
  });

  it('accepts valid English and Hindi', () => {
    assert.equal(
      isMeaningfulExtractedText('Quarterly revenue grew across enterprise renewals and lower churn.').ok,
      true,
    );
    assert.equal(isMeaningfulExtractedText('यह एक परीक्षण दस्तावेज़ है जिसमें पर्याप्त पठनीय पाठ है।').ok, true);
  });
});

describe('file validation', () => {
  it('rejects empty and unsupported files', () => {
    assert.equal(validateUploadFile({ name: 'a.pdf', type: 'application/pdf', size: 0 })?.code, 'EMPTY_FILE');
    assert.equal(
      validateUploadFile({ name: 'a.exe', type: 'application/octet-stream', size: 100 })?.code,
      'UNSUPPORTED_TYPE',
    );
  });

  it('accepts pdf by extension even if mime is blank', () => {
    assert.equal(validateUploadFile({ name: 'report.pdf', type: '', size: 1200 }), null);
  });
});

describe('chunking + readiness', () => {
  it('creates page-aware chunks with metadata', () => {
    const chunks = chunkPageBlocks([
      { page: 1, text: 'Introduction paragraph with enough content for a meaningful retrieval unit about revenue.' },
      { page: 2, text: '| Year | Revenue |\n| --- | --- |\n| 2024 | 100 |\n| 2025 | 150 |' },
    ]);
    assert.ok(chunks.length >= 2);
    assert.equal(chunks[0].page, 1);
    assert.ok(chunks.some((c) => c.content.includes('Revenue')));
  });

  it('skips tiny meaningless chunks', () => {
    const chunks = chunkText('ok');
    assert.equal(chunks.length, 0);
  });

  it('splits long PDF-style blocks that have no blank lines', () => {
    const text = Array.from({ length: 30 }, (_, index) =>
      `Line ${index + 1} contains a distinct document fact with enough words for retrieval.`,
    ).join('\n');
    const chunks = chunkPageBlocks([{ page: 1, text }], 500, 50);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.content.length <= 520));
    assert.ok(chunks.every((chunk) => chunk.page === 1));
  });

  it('builds ready and failed readiness correctly', () => {
    const failed = buildFailedOcrReadiness({ fileSize: 10, ocrUsed: true });
    assert.equal(failed.grounded, false);
    assert.equal(failed.chunksCreated, 0);
    assert.equal(failed.readinessCoverage, 0);

    const ready = buildReadyReadiness({
      fileSize: 10,
      textLength: 1240,
      chunksCreated: 4,
      embeddingsCreated: 4,
      ocrUsed: false,
      pageStats: {
        totalPages: 4,
        processedPages: 4,
        nativeTextPages: 4,
        ocrPages: 0,
        ocrFailedPages: 0,
        ocrSkippedPages: 0,
        failedPages: 0,
        warnings: [],
      },
    });
    assert.equal(isDocumentQueryable(ready.status), true);
    assert.ok(ready.readinessCoverage >= 70);
  });

  it('marks ready_with_warnings for partial page failures', () => {
    const ready = buildReadyReadiness({
      fileSize: 10,
      textLength: 800,
      chunksCreated: 3,
      embeddingsCreated: 3,
      ocrUsed: true,
      pageStats: {
        totalPages: 10,
        processedPages: 8,
        nativeTextPages: 6,
        ocrPages: 2,
        ocrFailedPages: 2,
        ocrSkippedPages: 0,
        failedPages: 2,
        warnings: ['2 page(s) produced no usable text.'],
      },
    });
    assert.equal(ready.status, 'ready_with_warnings');
  });

  it('computes deterministic coverage', () => {
    const score = computeReadinessCoverage({
      textLength: 500,
      chunksCreated: 2,
      embeddingsCreated: 2,
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
    assert.ok(score > 0 && score <= 100);
  });
});

describe('retrieval helpers', () => {
  it('scores lexical overlap and hybrid blend', () => {
    assert.ok(lexicalScore('revenue growth', 'Annual revenue growth improved') > 0.4);
    assert.ok(hybridScore(0.2, 0.8) > hybridScore(0.2, 0.1));
  });

  it('dedupes near-identical chunks', () => {
    const result = dedupeByContent([
      { content: 'The company revenue grew twenty percent in Q3.', relevance: 0.9 },
      { content: 'The company revenue grew twenty percent in Q3.', relevance: 0.8 },
      { content: 'Completely different evidence about hiring plans.', relevance: 0.7 },
    ]);
    assert.equal(result.length, 2);
  });

  it('keeps all chunks for broad questions over a small document', async () => {
    const store = new MemoryStore();
    store.clearAll();
    resetStoreForTests(store);
    await store.replaceChunks('small-doc', [
      { id: 'a', documentId: 'small-doc', content: 'Student verification details.', chunkIndex: 0, embedding: null, embeddingModel: null, fileName: 'letter.pdf', fileType: 'application/pdf', extractedAt: '2026-01-01', lexicalText: 'student verification' },
      { id: 'b', documentId: 'small-doc', content: 'Tuition and semester fee details.', chunkIndex: 1, embedding: null, embeddingModel: null, fileName: 'letter.pdf', fileType: 'application/pdf', extractedAt: '2026-01-01', lexicalText: 'tuition semester fee' },
      { id: 'c', documentId: 'small-doc', content: 'Payment account and deadline details.', chunkIndex: 2, embedding: null, embeddingModel: null, fileName: 'letter.pdf', fileType: 'application/pdf', extractedAt: '2026-01-01', lexicalText: 'payment account deadline' },
    ]);

    const result = await searchDocument('small-doc', 'What is this document about?', 3, { includeAllWhenSmall: true });
    assert.equal(result.results.length, 3);
    resetStoreForTests();
  });
});

describe('duplicate hash', () => {
  it('hashes identical buffers the same way', () => {
    const a = hashFileBuffer(Buffer.from('hello-docagent'));
    const b = hashFileBuffer(Buffer.from('hello-docagent'));
    const c = hashFileBuffer(Buffer.from('other'));
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});
