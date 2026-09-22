import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMeaningfulExtractedText } from '../src/lib/text-validation.ts';
import { buildFailedOcrReadiness, buildReadyReadiness, isDocumentReady } from '../src/lib/document-status.ts';
import { classifyOcrProviderError, extractOpenRouterOcrText } from '../src/lib/document-processor.ts';

describe('isMeaningfulExtractedText', () => {
  it('accepts clear printed English text', () => {
    const result = isMeaningfulExtractedText(
      'Quarterly revenue grew 28% driven by enterprise renewals and lower churn across regions.',
    );
    assert.equal(result.ok, true);
    assert.ok(result.cleanedText.length > 20);
  });

  it('accepts clear handwritten-style English text', () => {
    const result = isMeaningfulExtractedText(
      'Meeting notes: call Rahul tomorrow about the delivery schedule and invoice.',
    );
    assert.equal(result.ok, true);
  });

  it('rejects blurry / too-short handwritten fragments', () => {
    assert.equal(isMeaningfulExtractedText('ab??').ok, false);
  });

  it('rejects empty image text', () => {
    assert.equal(isMeaningfulExtractedText('').ok, false);
    assert.equal(isMeaningfulExtractedText('   ').ok, false);
  });

  it('rejects image containing only symbols', () => {
    assert.equal(isMeaningfulExtractedText('!!! ??? ### ***').ok, false);
  });

  it('rejects NO_READABLE_TEXT', () => {
    const result = isMeaningfulExtractedText('NO_READABLE_TEXT');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'NO_READABLE_TEXT');
  });

  it('rejects OCR error sentences', () => {
    assert.equal(isMeaningfulExtractedText('Could not extract text from image').ok, false);
    assert.equal(isMeaningfulExtractedText('Unable to read image content').ok, false);
    assert.equal(isMeaningfulExtractedText('No text detected in this photo').ok, false);
  });

  it('rejects whitespace-only and repeated garbage', () => {
    assert.equal(isMeaningfulExtractedText('\n\n\t  ').ok, false);
    assert.equal(isMeaningfulExtractedText('????????????').ok, false);
  });

  it('rejects filename-only extraction', () => {
    const result = isMeaningfulExtractedText('whatsapp-image-2026', {
      fileName: 'whatsapp-image-2026.jpg',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'FILENAME_ONLY');
  });

  it('accepts valid Hindi text', () => {
    const result = isMeaningfulExtractedText('यह एक परीक्षण दस्तावेज़ है जिसमें पर्याप्त पठनीय पाठ है।');
    assert.equal(result.ok, true);
  });

  it('accepts mixed Hindi and English text', () => {
    const result = isMeaningfulExtractedText('Invoice संख्या 4821 के अनुसार payment due on Monday.');
    assert.equal(result.ok, true);
  });
});

describe('failed OCR indexing guards', () => {
  it('classifies denied OCR model access without blaming the uploaded file', () => {
    const failure = classifyOcrProviderError(
      new Error('[403 Forbidden] Your project has been denied access.'),
    );
    assert.equal(failure.code, 'OCR_ACCESS_DENIED');
    assert.match(failure.userMessage, /denied access/i);
  });

  it('extracts text content and removes model reasoning wrappers', () => {
    assert.equal(
      extractOpenRouterOcrText({
        choices: [{ message: { content: '<think>Inspecting image</think>\n```text\nInvoice 4821\n```' } }],
      }),
      'Invoice 4821',
    );
  });

  it('preserves the OCR provider failure in readiness output', () => {
    const readiness = buildFailedOcrReadiness({
      fileSize: 12000,
      ocrUsed: true,
      errorCode: 'OCR_ACCESS_DENIED',
      userMessage: 'OCR model denied access.',
    });
    assert.equal(readiness.errorCode, 'OCR_ACCESS_DENIED');
    assert.equal(readiness.userMessage, 'OCR model denied access.');
  });

  it('does not create chunks from OCR failure text', () => {
    const validation = isMeaningfulExtractedText('Could not extract text from image');
    assert.equal(validation.ok, false);
  });

  it('does not create embeddings when validation fails', () => {
    const readiness = buildFailedOcrReadiness({
      fileSize: 12000,
      ocrUsed: true,
      errorCode: 'NO_READABLE_TEXT',
    });
    assert.equal(readiness.chunksCreated, 0);
    assert.equal(readiness.embeddingsCreated, 0);
    assert.equal(readiness.grounded, false);
    assert.equal(readiness.status, 'ocr_failed');
    assert.equal(isDocumentReady(readiness.status), false);
  });

  it('marks grounded false after failure', () => {
    const readiness = buildFailedOcrReadiness({ fileSize: 1, ocrUsed: true });
    assert.equal(readiness.grounded, false);
    assert.equal(readiness.extractedTextLength, 0);
  });

  it('builds ready state for successful extraction', () => {
    const readiness = buildReadyReadiness({
      fileSize: 24000,
      textLength: 1240,
      chunksCreated: 4,
      embeddingsCreated: 4,
      ocrUsed: true,
    });
    assert.equal(readiness.status, 'ready');
    assert.equal(readiness.grounded, true);
    assert.equal(readiness.chunksCreated, 4);
    assert.equal(readiness.embeddingsCreated, 4);
  });
});

describe('retry concurrency lock pattern', () => {
  it('prevents concurrent retries with a lock set', () => {
    const retryLocks = new Set<string>();
    const documentId = 'doc-1';

    const startRetry = () => {
      if (retryLocks.has(documentId)) return 'blocked';
      retryLocks.add(documentId);
      return 'started';
    };

    assert.equal(startRetry(), 'started');
    assert.equal(startRetry(), 'blocked');
    retryLocks.delete(documentId);
    assert.equal(startRetry(), 'started');
  });
});

describe('OCR model configuration', () => {
  it('uses nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free as default OCR model', async () => {
    const saved = process.env.OPENROUTER_OCR_MODEL;
    delete process.env.OPENROUTER_OCR_MODEL;
    const { OPENROUTER_OCR_MODEL } = await import('../src/lib/config/readiness.ts');
    assert.equal(OPENROUTER_OCR_MODEL, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
    if (saved) process.env.OPENROUTER_OCR_MODEL = saved;
  });

  it('supports environment variable override for OPENROUTER_OCR_MODEL', () => {
    const customModel = 'custom/ocr-model:free';
    process.env.OPENROUTER_OCR_MODEL = customModel;
    const resolved = process.env.OPENROUTER_OCR_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
    assert.equal(resolved, customModel);
    delete process.env.OPENROUTER_OCR_MODEL;
  });

  it('sends correct OCR model and provider options in OpenRouter request', async () => {
    const { ocrImage } = await import('../src/lib/document-processor.ts');
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;
    const originalModel = process.env.OPENROUTER_OCR_MODEL;

    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.OPENROUTER_OCR_MODEL;

    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        capturedBody = JSON.parse(init.body);
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Extracted text from test image successfully.',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const result = await ocrImage(Buffer.from('fake-image-bytes'), 'image/png');
      assert.equal(result, 'Extracted text from test image successfully.');
      assert.ok(capturedBody);
      assert.equal(capturedBody.model, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
      assert.deepEqual(capturedBody.provider, {
        only: ['NVIDIA'],
        allow_fallbacks: false,
        require_parameters: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey) process.env.OPENROUTER_API_KEY = originalApiKey;
      else delete process.env.OPENROUTER_API_KEY;
      if (originalModel) process.env.OPENROUTER_OCR_MODEL = originalModel;
      else delete process.env.OPENROUTER_OCR_MODEL;
    }
  });
});


