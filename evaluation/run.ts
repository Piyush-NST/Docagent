/**
 * Offline evaluation foundation.
 *
 * Usage:
 *   npx tsx evaluation/run.ts
 *   npm run eval:retrieval
 */

import assert from 'node:assert/strict';
import dataset from './dataset.json';

function scoreRefusal(answer: string): boolean {
  const lower = answer.toLowerCase();
  return lower.includes("couldn't find sufficient evidence") || lower.includes('uploaded documents');
}

function main() {
  const simulatedNoEvidenceAnswer =
    "I couldn't find sufficient evidence for this in the uploaded documents.\n\nThe retrieved passages do not clearly support an answer without guessing.";

  const refusalCase = dataset.cases.find((c) => c.id === 'no-evidence-refusal');
  assert.ok(refusalCase);
  assert.equal(scoreRefusal(simulatedNoEvidenceAnswer), true);

  console.log('evaluation/run.ts: refusal foundation check PASS');
  console.log('Run `npm run eval:retrieval` for paraphrase lexical-baseline fixtures.');
  console.log(
    'Live semantic Recall@K requires GEMINI_API_KEY + indexed docs and is not reported as a production UI metric.',
  );
}

main();
