import { classifyAnswerIntent, retrievalQueryForIntent, topKForIntent } from '../src/lib/answer-intent';
import { generateGroundedResponse } from '../src/lib/gemini';
import { searchDocument } from '../src/lib/vector-store';

const queries = [
  'What is this document about?',
  'Who is this for?',
  'What is the enrollment number?',
  'Who issued this?',
  'What is the address?',
  'Summarize this document.',
  'Explain this in detail.',
  'What is the CGPA?',
  "Give me the student's name and enrollment number.",
];

async function main() {
  const documentId = process.argv[2];
  if (!documentId) throw new Error('Usage: npm run eval:answers -- <document-id>');

  for (const question of queries) {
    const intent = classifyAnswerIntent(question);
    const outcome = await searchDocument(
      documentId,
      retrievalQueryForIntent(question, intent),
      topKForIntent(intent),
    );
    const response = await generateGroundedResponse(
      question,
      outcome.results.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        page: chunk.page,
        section: chunk.section,
        relevance: chunk.relevance,
        fileName: chunk.metadata.fileName,
        documentId: chunk.documentId,
      })),
      'ask',
      { answerIntent: intent },
    );

    console.log(JSON.stringify({
      question,
      intent,
      answer: response.answer,
      answerType: response.structuredAnswer?.answerType || 'markdown',
      citations: response.sources.map((source) => ({ chunkId: source.chunkId, page: source.page })),
      grounded: response.isGrounded,
      retrievalMode: outcome.retrievalMode,
    }));
  }
}

void main();
