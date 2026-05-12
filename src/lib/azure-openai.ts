// ai client for chat and embeddings

import Groq from 'groq-sdk';

const isMockMode = process.env.USE_MOCK_MODE === 'true';

function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not found');
  return new Groq({ apiKey });
}

// groq doesnt have embedding api so using local method
function generateLocalEmbedding(text: string): number[] {
  const embedding: number[] = [];
  const words = text.toLowerCase().split(/\s+/);
  
  for (let i = 0; i < 384; i++) {
    let value = 0;
    for (const word of words) {
      const hash = word.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      value += Math.sin((hash + i) * 0.1) * Math.cos((hash - i) * 0.05);
    }
    embedding.push(value / Math.max(words.length, 1));
  }
  
  // normalize
  const mag = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  return mag ? embedding.map(v => v / mag) : embedding;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  console.log(`[Local] Embedding for ${text.length} chars`);
  return generateLocalEmbedding(text);
}

export interface GroundedResponse {
  answer: string;
  sources: Array<{
    chunkId: string;
    page?: number;
    section?: string;
    relevance: number;
  }>;
  isGrounded: boolean;
}

const notFoundAnswer = `I could not find a grounded answer to that question in the indexed document content.

I searched the retrieved passages, but they do not mention the requested detail clearly enough to answer without guessing. Try asking with a specific page, heading, date, name, or keyword from the document.`;

// generates answer from the relevant chunks
export async function generateGroundedResponse(
  question: string,
  retrievedChunks: Array<{
    id: string;
    content: string;
    page?: number;
    section?: string;
    relevance: number;
  }>
): Promise<GroundedResponse> {
  
  let context = '';
  for (let i = 0; i < retrievedChunks.length; i++) {
    const chunk = retrievedChunks[i];
    let label = `[Source ${i + 1}`;
    if (chunk.page) label += ` - Page ${chunk.page}`;
    label += ']';
    context += `${label}\n${chunk.content}\n\n---\n\n`;
  }

  if (retrievedChunks.length === 0) {
    return {
      answer: notFoundAnswer,
      sources: [],
      isGrounded: false,
    };
  }

  if (isMockMode) {
    const preview = retrievedChunks[0].content.substring(0, 400);
    return {
      answer: `Based on document:\n\n${preview}...\n\n[Source 1]`,
      sources: retrievedChunks.map(c => ({ chunkId: c.id, page: c.page, section: c.section, relevance: c.relevance })),
      isGrounded: true,
    };
  }

  const prompt = `You are a document assistant. Answer based ONLY on the context below.

Rules:
1. Only use info from the context - dont make stuff up
2. If answer is not clearly present in the context, use this exact response:
${notFoundAnswer}
3. Cite sources like [Source 1] or [Source 2, Page 3]
4. Be concise

Document Context:
${context}

Question: ${question}`;

  const client = getGroqClient();
  
  console.log('[Groq] Generating response...');
  
  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1000,
  });

  const answer = response.choices[0]?.message?.content || 'Could not generate response.';
  console.log('[Groq] Response generated');

  const lowerAnswer = answer.toLowerCase();
  const isGrounded = !lowerAnswer.includes('could not find') && !lowerAnswer.includes('without guessing');

  return {
    answer,
    sources: retrievedChunks.map(c => ({ chunkId: c.id, page: c.page, section: c.section, relevance: c.relevance })),
    isGrounded,
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector length mismatch');
  
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  
  return (magA && magB) ? dot / (magA * magB) : 0;
}
