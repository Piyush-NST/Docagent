import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyGeminiError,
  classifyOpenRouterError,
  generateGroundedResponse,
  generationFallbackNotice,
  isLikelyTruncatedOutput,
  outputTokenBudget,
  recoverModelStructuredAnswer,
} from '../src/lib/gemini';
import { classifyAnswerIntent } from '../src/lib/answer-intent';

const letter = `Rishihood University
NH-44, Near Bahalgarh Chowk, Sonipat, Haryana - 131021
Ph: +91-130-3520100 | Email: admissions@rishihood.edu.in
Date: 23.06.2026
TO WHOM SO EVER IT MAY CONCERN
This is to certify that Mr./Ms. Prerak Arya (Enrolment No. 230039) S/o Guardian is a bonafide student of B. Tech
(Computer Science & Artificial Intelligence) course.
Total Due Fee 0/-
Account Number : 11122220260608880035
For Rishihood University
Authorized Signatory`;

const chunks = [{
  id: 'letter-page-1', documentId: 'letter', fileName: 'demand-letter (1).pdf', page: 1, relevance: 1, content: letter,
}];

async function ask(question: string) {
  return generateGroundedResponse(question, chunks, 'ask');
}

describe('adaptive grounded answer quality', () => {
  it('classifies demand-letter (1).pdf as a fee notice without dumping letterhead', async () => {
    const response = await ask('What is this document about?');
    assert.match(response.answer, /fee demand and payment notice/i);
    assert.match(response.answer, /Prerak Arya/);
    assert.doesNotMatch(response.answer, /bonafide\/student verification letter/i);
    assert.doesNotMatch(response.answer, /admissions@/i);
  });

  it('uses fee evidence over generic student verification language in ambiguous university documents', async () => {
    const response = await generateGroundedResponse('What is this document about?', [{
      id: 'ambiguous-letter',
      documentId: 'ambiguous',
      fileName: 'student-letter.pdf',
      page: 1,
      relevance: 1,
      content: `To whomsoever it may concern. This is to certify that Asha Rao, enrollment number 42, is a student.
        The semester fee amount is due and payable. Tuition fee and payment account details follow.`,
    }], 'ask');

    assert.match(response.answer, /fee demand and payment notice/i);
    assert.doesNotMatch(response.answer, /bonafide student verification letter/i);
  });

  it('keeps strong bonafide evidence classified as student verification', async () => {
    const response = await generateGroundedResponse('What is this document about?', [{
      id: 'verification-letter',
      documentId: 'verification',
      fileName: 'student-letter.pdf',
      page: 1,
      relevance: 1,
      content: `Rishihood University. This is to certify that Mr. Aman Shah is a bona fide student,
        currently enrolled in the B.Tech course. This student verification letter is issued on request.`,
    }], 'ask');

    assert.match(response.answer, /bonafide student verification letter/i);
  });

  it('answers single-fact lookups with only the requested value', async () => {
    const recipient = await ask('Who is this for?');
    assert.match(recipient.answer, /Prerak Arya/);
    assert.equal(recipient.debug?.answerGenerator, 'deterministic_lookup');
    assert.equal(recipient.debug?.fallbackUsed, false);
    assert.equal(recipient.debug?.structuredOutputValid, true);
    assert.match((await ask('What is the enrollment number?')).answer, /230039/);
    assert.match((await ask('Who issued this?')).answer, /Rishihood University/);
    const address = (await ask('What is the address?')).answer;
    assert.match(address, /NH-44, Near Bahalgarh Chowk/);
    assert.doesNotMatch(address, /Email|TO WHOM|certify that/i);
    const fees = await ask('How much fees?');
    assert.match(fees.answer, /Rs\. 0\/-/);
    assert.equal(fees.debug?.answerGenerator, 'deterministic_lookup');
    assert.equal(fees.generationNotice, undefined);
  });

  it('routes multi-detail synthesis to Gemini instead of deterministic fact lookup', () => {
    assert.equal(
      classifyAnswerIntent('Explain the fee components, total payable amount, and payment account details.'),
      'detail',
    );
  });

  it('treats key findings as a summary and accurately labels validation fallback', () => {
    assert.equal(classifyAnswerIntent('What are the key findings?'), 'summary');
    assert.match(generationFallbackNotice('structured_output_invalid') || '', /could not be safely validated/i);
    assert.doesNotMatch(generationFallbackNotice('structured_output_invalid') || '', /currently unavailable/i);
  });

  it('keeps broad and multi-part questions out of atomic fact routing', () => {
    const summaryQuestions = [
      'What are the key findings?',
      'What are the important points?',
      'What should I know from this document?',
      'What does this document say?',
      'Tell me the main details.',
      'What are the key takeaways?',
    ];
    summaryQuestions.forEach((question) => assert.equal(classifyAnswerIntent(question), 'summary', question));
    assert.equal(classifyAnswerIntent('Explain the important information.'), 'detail');
    assert.equal(classifyAnswerIntent('How much are the fees and what are the payment details?'), 'multi_field');
    assert.equal(classifyAnswerIntent('What are the fees and where should I pay?'), 'multi_field');

    [
      'What is the enrollment number?',
      'What is the fee amount?',
      'Who issued this?',
      'What is the date?',
      'What is the CGPA?',
    ].forEach((question) => assert.equal(classifyAnswerIntent(question), 'fact', question));
  });

  it('uses intent-specific structured output budgets', () => {
    assert.equal(outputTokenBudget('ask', 'fact'), 800);
    assert.equal(outputTokenBudget('ask', 'multi_field'), 1000);
    assert.equal(outputTokenBudget('ask', 'overview'), 1000);
    assert.equal(outputTokenBudget('ask', 'summary'), 1600);
    assert.equal(outputTokenBudget('ask', 'detail'), 2400);
    assert.equal(outputTokenBudget('ask', 'general'), 1600);
  });

  it('detects truncated JSON and retries once with a larger budget', async () => {
    const truncated = '{"answer":"The document says';
    assert.equal(isLikelyTruncatedOutput(truncated, 'length'), true);
    let calls = 0;
    const recovered = await recoverModelStructuredAnswer({
      initial: { content: truncated, finishReason: 'length' },
      intent: 'summary',
      initialBudget: 1600,
      retry: async (type, _raw, budget) => {
        calls += 1;
        assert.equal(type, 'truncation');
        assert.equal(budget, 3200);
        return {
          content: JSON.stringify({ answer: 'The document covers fee and payment information.', answerType: 'summary', citationIds: [1], items: [] }),
          finishReason: 'stop',
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(recovered.answer?.answerType, 'summary');
    assert.equal(recovered.retryUsed, true);
    assert.equal(recovered.retryType, 'truncation');
  });

  it('uses one repair retry for malformed JSON and reports repair failure safely', async () => {
    const malformed = '{ answer: "Fee details", "answerType": "summary", "items": [] }';
    const repaired = await recoverModelStructuredAnswer({
      initial: { content: malformed, finishReason: 'stop' },
      intent: 'summary',
      initialBudget: 1600,
      retry: async (type) => {
        assert.equal(type, 'repair');
        return {
          content: JSON.stringify({ answer: 'Fee details are provided in the document.', answerType: 'summary', citationIds: [1], items: [] }),
          finishReason: 'stop',
        };
      },
    });
    assert.equal(repaired.answer?.answerType, 'summary');
    assert.equal(repaired.retryType, 'repair');

    let calls = 0;
    const failed = await recoverModelStructuredAnswer({
      initial: { content: malformed, finishReason: 'stop' },
      intent: 'summary',
      initialBudget: 1600,
      retry: async () => {
        calls += 1;
        return { content: '{ still invalid }', finishReason: 'stop' };
      },
    });
    assert.equal(calls, 1);
    assert.equal(failed.answer, undefined);
    assert.equal(failed.failureReason, 'malformed_json');
    assert.match(generationFallbackNotice('structured_output_invalid') || '', /local grounded fallback/i);
  });

  it('repairs a valid response whose answer type does not match the requested intent', async () => {
    let calls = 0;
    const recovered = await recoverModelStructuredAnswer({
      initial: {
        content: JSON.stringify({ answer: 'A short overview.', answerType: 'overview', citationIds: [1], items: [] }),
        finishReason: 'stop',
      },
      intent: 'summary',
      initialBudget: 1600,
      retry: async (type, _raw, budget) => {
        calls += 1;
        assert.equal(type, 'repair');
        assert.equal(budget, 1600);
        return {
          content: JSON.stringify({ answer: 'A concise summary.', answerType: 'summary', citationIds: [1], items: [] }),
          finishReason: 'stop',
        };
      },
    });

    assert.equal(calls, 1);
    assert.equal(recovered.answer?.answerType, 'summary');
    assert.equal(recovered.retryUsed, true);
    assert.equal(recovered.retryType, 'repair');
  });

  it('distinguishes Gemini quota, key, billing, rate, and access failures', () => {
    const failure = (message: string, status: number) => Object.assign(new Error(message), { status });
    assert.equal(classifyGeminiError(failure('API_KEY_INVALID: API key not valid', 400)).reason, 'invalid_api_key');
    assert.equal(classifyGeminiError(failure('free_tier_requests, limit: 0', 429)).reason, 'free_tier_unavailable');
    assert.equal(classifyGeminiError(failure('Billing required: enable billing', 403)).reason, 'billing_required');
    assert.equal(classifyGeminiError(failure('Quota exceeded for requests per day', 429)).reason, 'quota_exceeded');
    assert.equal(classifyGeminiError(failure('Too many requests, retry in 10s', 429)).reason, 'rate_limit');
    assert.equal(classifyGeminiError(failure('Your project has been denied access', 403)).reason, 'model_access_denied');
  });

  it('distinguishes OpenRouter key, free-model, and rate failures', () => {
    const failure = (message: string, status: number) => Object.assign(new Error(message), { status });
    assert.equal(classifyOpenRouterError(failure('Invalid API key', 401)).reason, 'invalid_api_key');
    assert.equal(classifyOpenRouterError(failure('Insufficient credits', 402)).reason, 'billing_required');
    assert.equal(classifyOpenRouterError(failure('Not a valid model ID', 404)).reason, 'model_unavailable');
    assert.equal(classifyOpenRouterError(failure('Rate limit exceeded', 429)).reason, 'rate_limit');
  });

  it('adapts summary and detailed response depth', async () => {
    const summary = await ask('Summarize this document.');
    const detail = await ask('Explain this in detail.');
    assert.equal(summary.structuredAnswer?.answerType, 'summary');
    assert.ok(detail.answer.length > summary.answer.length);
    assert.match(detail.answer, /Additional document details/);
  });

  it('explicitly reports unavailable facts without hallucinating', async () => {
    const response = await ask('What is the CGPA?');
    assert.equal(response.answer, "I couldn't find that information in this document.");
    assert.equal(response.isGrounded, false);
  });

  it('returns requested multiple fields as key-value data with citations', async () => {
    const response = await ask("Give me the student's name and enrollment number.");
    assert.equal(response.structuredAnswer?.answerType, 'key_value');
    assert.match(response.answer, /Prerak Arya/);
    assert.match(response.answer, /230039/);
    assert.equal(response.sources[0].page, 1);
  });
});
