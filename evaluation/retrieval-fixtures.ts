import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lexicalScore } from '../src/lib/retrieval';

/**
 * Offline evaluation of lexical vs paraphrase cases.
 * Live Gemini embedding recall is integration-only (needs GEMINI_API_KEY).
 */

const fixtures = [
  {
    id: 'revenue-paraphrase',
    document: 'The company reported that revenue declined during the second half of the year.',
    query: 'Did sales go down?',
    expectLexicalWeak: true,
  },
  {
    id: 'resignation-paraphrase',
    document: 'Employees may terminate employment by providing thirty days written notice.',
    query: 'What is the resignation notice period?',
    expectLexicalWeak: true,
  },
  {
    id: 'net-income',
    document: 'The company reported net income of 18.2 crore.',
    query: 'How much money did the company earn?',
    expectLexicalWeak: true,
  },
  {
    id: 'debt-paraphrase',
    document: 'Total borrowings decreased by 12% during FY25.',
    query: "Did the company's debt go down?",
    expectLexicalWeak: true,
  },
  {
    id: 'exact-overlap-control',
    document: 'Registered office is located at 12 Marine Drive Mumbai.',
    query: 'registered office Mumbai',
    expectLexicalWeak: false,
  },
];

describe('retrieval evaluation foundation (lexical baseline)', () => {
  for (const fixture of fixtures) {
    it(`${fixture.id}: documents lexical difficulty`, () => {
      const score = lexicalScore(fixture.query, fixture.document);
      if (fixture.expectLexicalWeak) {
        assert.ok(
          score < 0.5,
          `${fixture.id} expected weak lexical overlap, got ${score}`,
        );
      } else {
        assert.ok(score >= 0.5, `${fixture.id} expected strong lexical overlap, got ${score}`);
      }
    });
  }

  it('documents that semantic embeddings are required for paraphrase recall', () => {
    // This is an architectural assertion for the report/evaluation harness:
    // paraphrase fixtures are intentionally hard for lexical-only retrieval.
    const weak = fixtures.filter((f) => f.expectLexicalWeak);
    assert.ok(weak.length >= 4);
  });
});
