import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  friendlyDocumentName,
  modelAnswerToStructuredAnswer,
  parseModelStructuredAnswer,
  parseStructuredAnswer,
  structuredAnswerToMarkdown,
} from '../src/lib/structured-answer';
import { generateGroundedResponse } from '../src/lib/gemini';

describe('structured answer parsing', () => {
  it('parses profile responses and citation mapping', () => {
    const answer = parseStructuredAnswer(JSON.stringify({
      version: 1,
      answerType: 'profile',
      title: 'Prerak Arya',
      subtitle: 'Computer Science & AI Student',
      summary: 'Full-stack and AI-focused developer.',
      citationIds: [1],
      sections: [
        { type: 'key_value', title: 'Contact', items: [{ label: 'Email', value: 'prerak@example.com', citationIds: [1] }] },
      ],
    }));
    assert.equal(answer?.answerType, 'profile');
    assert.deepEqual(answer?.sections[0], {
      type: 'key_value',
      title: 'Contact',
      items: [{ label: 'Email', value: 'prerak@example.com', citationIds: [1] }],
    });
  });

  it('parses key-value and list responses', () => {
    const kv = parseStructuredAnswer({
      version: 1,
      answerType: 'key_value',
      sections: [{ type: 'key_value', items: [{ label: 'Amount', value: '₹84,500' }] }],
    });
    const list = parseStructuredAnswer({
      version: 1,
      answerType: 'list',
      title: 'Technologies',
      sections: [{ type: 'bullets', items: ['JavaScript', { text: 'Python', citationIds: [2] }] }],
    });
    assert.equal(kv?.answerType, 'key_value');
    assert.equal(list?.sections.length, 1);
  });

  it('parses responsive comparison tables', () => {
    const answer = parseStructuredAnswer({
      version: 1,
      answerType: 'comparison',
      sections: [{ type: 'table', columns: ['Metric', 'FY24', 'FY25'], rows: [['Revenue', '₹120 Cr', '₹142 Cr']], citationIds: [1, 2] }],
    });
    assert.deepEqual(answer?.sections[0], {
      type: 'table', columns: ['Metric', 'FY24', 'FY25'], rows: [['Revenue', '₹120 Cr', '₹142 Cr']], citationIds: [1, 2],
    });
  });

  it('falls back safely for malformed or invalid structured output', () => {
    assert.equal(parseStructuredAnswer('```json\n{"answerType":"profile"\n```'), null);
    assert.equal(parseStructuredAnswer({ version: 1, answerType: 'profile', sections: [{ type: 'table', columns: ['Only'], rows: [] }] }), null);
  });

  it('normalizes Markdown emphasis around an otherwise valid bare JSON value', () => {
    const answer = parseStructuredAnswer(`{
      "version": 1,
      "answerType": "key_value",
      "sections": [{
        "type": "key_value",
        "items": [{ "label": **Total Due Fee**, "value": "₹0", "citationIds": [1] }]
      }]
    }`);
    assert.deepEqual(answer?.sections[0], {
      type: 'key_value',
      items: [{ label: 'Total Due Fee', value: '₹0', citationIds: [1] }],
    });
  });

  it('normalizes safe shallow-schema formatting errors before validation', () => {
    const result = parseModelStructuredAnswer(`Before the JSON\n\`\`\`json
      {
        “answer”: “The total due fee is ₹0.”,
        “answerType”: “fact”,
        “citationIds”: [1],
        “items”: [{ “label”: **Total Due Fee**, “value”: “**₹0**”, “citationIds”: [1], }],
      }
    \`\`\`\nAfter the JSON`);
    assert.equal(result.failureReason, undefined);
    assert.equal(result.answer?.items[0].label, 'Total Due Fee');
    assert.equal(result.answer?.items[0].value, '₹0');
    assert.ok(result.normalizationApplied.includes('removed_code_fence'));
    assert.ok(result.normalizationApplied.includes('normalized_smart_quotes'));
    assert.ok(result.normalizationApplied.includes('quoted_markdown_value'));
    assert.ok(result.normalizationApplied.includes('removed_markdown_emphasis'));
    assert.ok(result.normalizationApplied.includes('removed_trailing_commas'));
  });

  it('adapts the shallow model schema to the existing UI answer contract', () => {
    const structured = modelAnswerToStructuredAnswer({
      answer: 'The document summarizes the fee position.',
      answerType: 'summary',
      citationIds: [1],
      items: [{ label: 'Total Due Fee', value: '₹0', citationIds: [1] }],
    });
    assert.equal(structured.answerType, 'summary');
    assert.equal(structured.summary, 'The document summarizes the fee position.');
    assert.equal(structured.sections[0].type, 'key_value');
  });

  it('supports compact simple answers and markdown fallback serialization', () => {
    const answer = parseStructuredAnswer({
      version: 1,
      answerType: 'text',
      title: '8.0',
      subtitle: 'Rishihood University · B.Tech CS & AI',
      citationIds: [1],
      sections: [],
    });
    assert.equal(answer?.title, '8.0');
    assert.match(structuredAnswerToMarkdown(answer!), /# 8\.0/);
  });

  it('creates safe display names without changing stored filenames', () => {
    assert.equal(friendlyDocumentName('Resume-prerak arya (2) (1).pdf'), 'Resume — Prerak Arya');
    assert.equal(friendlyDocumentName('invoice_final_v3.pdf'), 'invoice final v3');
  });

  it('builds a source-attributed comparison when Gemini is unavailable', async () => {
    const response = await generateGroundedResponse('Compare these documents in detail', [
      {
        id: 'resume-1',
        documentId: 'resume',
        fileName: 'Resume-prerak arya (2) (1).pdf',
        page: 1,
        relevance: 0.9,
        content: 'Built production-ready ERP modules for campus workflows. Experienced with JavaScript, Python, and SQL.',
      },
      {
        id: 'guide-1',
        documentId: 'guide',
        fileName: 'GitHub-Profile-Setup-Guide.pdf',
        page: 1,
        relevance: 0.8,
        content: 'The setup guide explains GitHub profile statistics and API rate limit configuration for public deployments.',
      },
    ], 'compare');

    assert.equal(response.structuredAnswer?.answerType, 'comparison');
    assert.equal(response.structuredAnswer?.sections[0].type, 'table');
    assert.match(response.answer, /Resume — Prerak Arya/);
    assert.deepEqual(response.structuredAnswer?.citationIds, [1, 2]);
  });
});
