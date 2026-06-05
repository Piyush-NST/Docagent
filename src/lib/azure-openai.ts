// ai client for chat and embeddings

import { GoogleGenerativeAI } from '@google/generative-ai';

const isMockMode = process.env.USE_MOCK_MODE === 'true';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not found');
  return new GoogleGenerativeAI(apiKey);
}

function getGeminiErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('quota') || lowerMessage.includes('429') || lowerMessage.includes('too many requests')) {
    return 'Gemini quota or rate limit reached for this API key. Please wait a minute and try again, or enable billing/increase quota for the Gemini API project.';
  }

  if (lowerMessage.includes('api_key_invalid') || lowerMessage.includes('api key not valid')) {
    return 'Gemini API key is invalid. Please update GEMINI_API_KEY in .env.local with a valid Google AI Studio key.';
  }

  if (lowerMessage.includes('permission') || lowerMessage.includes('forbidden') || lowerMessage.includes('denied access')) {
    return 'Gemini API access is denied for this key or model. Check that the Gemini API is enabled for the project and that the selected model is allowed.';
  }

  if (lowerMessage.includes('not found') || lowerMessage.includes('not supported')) {
    return `Gemini model "${geminiModel}" is not available for this key. Set GEMINI_MODEL in .env.local to an enabled model.`;
  }

  return 'Gemini could not generate a response right now. Please try again.';
}

// using a local embedding method keeps document indexing fast and server-side
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

interface RetrievedChunk {
  id: string;
  content: string;
  page?: number;
  section?: string;
  relevance: number;
}

const notFoundAnswer = `I could not find a grounded answer to that question in the indexed document content.

I searched the retrieved passages, but they do not mention the requested detail clearly enough to answer without guessing. Try asking with a specific page, heading, date, name, or keyword from the document.`;

function normalizeText(text: string): string {
  return text
    .replace(/\bfrom\s+0\s+1\b/gi, '')
    .replace(/\b0\s+1\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function splitSentences(text: string): string[] {
  const normalized = normalizeText(text);
  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return sentences.map(sentence => sentence.trim()).filter(sentence => sentence.length > 24);
}

function getCleanLines(chunks: RetrievedChunk[]): string[] {
  const headingOnly = new Set([
    'education',
    'experience',
    'projects',
    'professional summary',
    'skills',
    'technical skills',
    'work experience',
  ]);

  const markedText = chunks
    .map(chunk => chunk.content)
    .join('\n')
    .replace(/\b(PROFESSIONAL SUMMARY|EDUCATION|EXPERIENCE|PROJECTS|SKILLS|TECHNICAL SKILLS|WORK EXPERIENCE)\b/g, '\n$1\n');

  return markedText
    .split(/\n+|(?<=\.)\s+(?=[A-Z][A-Za-z ]{2,}:?)/)
    .map(normalizeText)
    .filter(line => {
      const lowerLine = line.toLowerCase();
      return (
        line.length > 18 &&
        !headingOnly.has(lowerLine) &&
        !/^\d,\s/.test(line) &&
        !/^com\b/i.test(line)
      );
    });
}

function compactFact(line: string): string[] {
  const cleaned = normalizeText(line);
  if (cleaned.length <= 180) return [cleaned];

  const parts = cleaned
    .split(/\s{2,}|;\s+|(?<=\.)\s+(?=[A-Z])|,\s+(?=(?:built|developed|integrated|optimized|collaborated|revamped|reduced|improved)\b)/i)
    .map(normalizeText)
    .filter(part => part.length > 24);

  if (parts.length <= 1) return [`${cleaned.slice(0, 177).trim()}...`];
  return parts.map(part => (part.length > 190 ? `${part.slice(0, 187).trim()}...` : part));
}

function getQuestionKeywords(question: string): string[] {
  const stopWords = new Set([
    'about',
    'anything',
    'document',
    'does',
    'from',
    'have',
    'list',
    'main',
    'show',
    'summarize',
    'tell',
    'that',
    'the',
    'this',
    'what',
    'when',
    'where',
    'which',
    'with',
    'your',
  ]);

  return Array.from(new Set(
    question
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter(word => !stopWords.has(word)) || []
  ));
}

function getBestSentences(question: string, chunks: RetrievedChunk[], limit = 5): string[] {
  const keywords = getQuestionKeywords(question);
  const ranked = chunks.flatMap((chunk, chunkIndex) =>
    splitSentences(chunk.content).map(sentence => {
      const lowerSentence = sentence.toLowerCase();
      const score = keywords.reduce((total, keyword) => total + (lowerSentence.includes(keyword) ? 1 : 0), 0);
      return {
        text: sentence,
        score,
        chunkIndex,
      };
    })
  );

  ranked.sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex);
  return ranked.slice(0, limit).map(item => item.text);
}

function buildDatesAndNumbersAnswer(chunks: RetrievedChunk[]): string {
  const matches: string[] = [];
  const seen = new Set<string>();
  const valuePattern = /(?:\+?\b\d{10,13}\b|\b\d{4}\s*[-–]\s*\d{4}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}[/-]\d{2,4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\$[0-9][0-9,]*(?:\.\d+)?\b|\b\d+(?:\.\d+)?%|\b\d{4}\b|\b\d+(?:\.\d+)?\b)/g;

  chunks.forEach((chunk) => {
    const segments = chunk.content
      .split(/\n+|(?<=[.!?])\s+/)
      .map(normalizeText)
      .filter(segment => segment.length > 8);

    for (const segment of segments) {
      for (const match of segment.matchAll(valuePattern)) {
        const value = match[0];
        const key = value.toLowerCase();
        const isTinyNumber = /^\d$/.test(value);
        if (isTinyNumber && !new RegExp(`grade\\s*:?\\s*${value}\\b`, 'i').test(segment)) continue;
        if (seen.has(key)) continue;

        seen.add(key);
        const preview = segment.length > 180 ? `${segment.slice(0, 177).trim()}...` : segment;
        matches.push(`- **${value}**: ${preview}`);

        if (matches.length >= 18) break;
      }
      if (matches.length >= 18) break;
    }
  });

  if (matches.length === 0) {
    return `${notFoundAnswer}`;
  }

  return `## Dates & Numbers\n\n${matches.join('\n')}`;
}

function buildStructuredSummaryAnswer(chunks: RetrievedChunk[]): string {
  const lines = getCleanLines(chunks);
  const buckets = {
    overview: [] as string[],
    education: [] as string[],
    experience: [] as string[],
    skills: [] as string[],
  };

  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    if (lowerLine.includes('education') || lowerLine.includes('bachelor') || lowerLine.includes('university') || lowerLine.includes('school') || lowerLine.includes('class ') || lowerLine.includes('grade')) {
      buckets.education.push(...compactFact(line));
    } else if (lowerLine.includes('project') || lowerLine.includes('experience') || lowerLine.includes('developer') || lowerLine.includes('built') || lowerLine.includes('worked')) {
      buckets.experience.push(...compactFact(line));
    } else if (lowerLine.includes('skill') || lowerLine.includes('react') || lowerLine.includes('typescript') || lowerLine.includes('javascript') || lowerLine.includes('python') || lowerLine.includes('llm')) {
      buckets.skills.push(...compactFact(line));
    } else {
      buckets.overview.push(...compactFact(line));
    }
  }

  const sections = [
    ['Overview', buckets.overview.slice(0, 3)],
    ['Education', buckets.education.slice(0, 5)],
    ['Experience / Projects', buckets.experience.slice(0, 7)],
    ['Skills', buckets.skills.slice(0, 6)],
  ].filter(([, items]) => items.length > 0) as Array<[string, string[]]>;

  if (sections.length === 0) {
    return `## Overview\n\n${normalizeText(chunks[0]?.content || '').slice(0, 700)}`;
  }

  return sections
    .map(([title, items]) => `## ${title}\n\n${items.map(item => `- ${item}`).join('\n')}`)
    .join('\n\n');
}

function buildKeyHighlightsAnswer(chunks: RetrievedChunk[]): string {
  const lines = getCleanLines(chunks)
    .flatMap(compactFact)
    .filter((line) => {
      const lowerLine = line.toLowerCase();
      const isContactOnly = lowerLine.includes('phone:') || lowerLine.includes('email:') || lowerLine.includes('linkedin');
      const isSubstantive =
        lowerLine.includes('developer') ||
        lowerLine.includes('built') ||
        lowerLine.includes('project') ||
        lowerLine.includes('experience') ||
        lowerLine.includes('education') ||
        lowerLine.includes('bachelor') ||
        lowerLine.includes('skill') ||
        lowerLine.includes('react') ||
        lowerLine.includes('gemini') ||
        lowerLine.includes('assistant') ||
        lowerLine.includes('workflow');

      return !isContactOnly && isSubstantive;
    });

  const highlights = Array.from(new Set(lines)).slice(0, 5);

  if (highlights.length === 0) {
    return buildStructuredSummaryAnswer(chunks);
  }

  return `## Key Highlights\n\n${highlights.map(item => `- ${item}`).join('\n')}`;
}

function generateLocalGroundedAnswer(question: string, chunks: RetrievedChunk[]): string {
  const lowerQuestion = question.toLowerCase();

  if (lowerQuestion.includes('date') || lowerQuestion.includes('number') || lowerQuestion.includes('amount')) {
    return buildDatesAndNumbersAnswer(chunks);
  }

  if (lowerQuestion.includes('summar')) {
    return buildStructuredSummaryAnswer(chunks);
  }

  if (lowerQuestion.includes('key finding') || lowerQuestion.includes('highlight')) {
    return buildKeyHighlightsAnswer(chunks);
  }

  const sentenceLimit = 4;
  const sentences = getBestSentences(question, chunks, sentenceLimit);

  if (sentences.length === 0) {
    const preview = normalizeText(chunks[0]?.content || '').slice(0, 700);
    if (!preview) return notFoundAnswer;
    return `## Overview\n\n${preview}`;
  }

  const title = lowerQuestion.includes('summar')
    ? 'Overview'
    : lowerQuestion.includes('key finding')
      ? 'Key Highlights'
      : 'Answer';

  return `## ${title}\n\n${sentences.map(sentence => `- ${sentence}`).join('\n')}`;
}

function buildSources(chunks: RetrievedChunk[]): GroundedResponse['sources'] {
  return chunks.map(c => ({ chunkId: c.id, page: c.page, section: c.section, relevance: c.relevance }));
}

// generates answer from the relevant chunks
export async function generateGroundedResponse(
  question: string,
  retrievedChunks: RetrievedChunk[]
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
      sources: buildSources(retrievedChunks),
      isGrounded: true,
    };
  }

  const prompt = `You are a document assistant. Answer based ONLY on the context below.

Rules:
1. Only use info from the context - dont make stuff up
2. If answer is not clearly present in the context, use this exact response:
${notFoundAnswer}
3. Format the response in clean markdown with relevant sections such as:
   ## Overview
   ## Key Highlights
   ## Education
   ## Experience / Projects
   ## Skills
   ## Dates & Numbers
4. Use concise bullets under sections.
5. Do not repeat source tags after every bullet. The app displays sources separately.
6. Clean obvious OCR artifacts and broken text before answering.

Document Context:
${context}

Question: ${question}`;

  let answer: string;
  try {
    const client = getGeminiClient();
    const model = client.getGenerativeModel({
      model: geminiModel,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1000,
      },
    });

    console.log('[Gemini] Generating grounded response...');
    const response = await model.generateContent(prompt);
    answer = response.response.text() || 'Could not generate response.';
    console.log('[Gemini] Grounded response generated');
  } catch (error) {
    console.error('[Gemini] Response generation failed, using local grounded fallback:', getGeminiErrorMessage(error));
    answer = generateLocalGroundedAnswer(question, retrievedChunks);
  }

  const lowerAnswer = answer.toLowerCase();
  const isGrounded = !lowerAnswer.includes('could not find') && !lowerAnswer.includes('without guessing');

  return {
    answer,
    sources: buildSources(retrievedChunks),
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
