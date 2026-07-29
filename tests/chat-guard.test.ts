import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDocumentReady } from '../src/lib/document-status';

describe('chat API readiness policy', () => {
  it('rejects non-ready document statuses', () => {
    const statuses = ['ocr_failed', 'needs_attention', 'failed', 'processing'] as const;
    for (const status of statuses) {
      assert.equal(isDocumentReady(status), false);
    }
  });

  it('allows ready documents', () => {
    assert.equal(isDocumentReady('ready'), true);
  });

  it('maps to DOCUMENT_NOT_READY response shape', () => {
    const status = 'ocr_failed';
    const body = {
      error: 'DOCUMENT_NOT_READY',
      message: 'This document does not contain enough readable text to answer questions.',
      status,
    };
    assert.equal(body.error, 'DOCUMENT_NOT_READY');
    assert.equal(body.status, 'ocr_failed');
  });
});
