/**
 * Centralized readiness / OCR policy.
 * Coverage is processing coverage (pages successfully read), never "AI accuracy".
 */
export const READINESS_THRESHOLDS = {
  /** processedUsablePages / totalPages ≥ this → Ready (if indexing ok) */
  readyMinPageCoverage: 0.85,
  /** ≥ this but below ready → Ready with warnings */
  warningMinPageCoverage: 0.5,
  /** ≥ this but below warning → Limited (queryable with caveats) */
  limitedMinPageCoverage: 0.15,
  /** Absolute minimum usable characters to index anything */
  minExtractedChars: 40,
  /** Soft text-length signal for non-page docs */
  strongTextLength: 180,
} as const;

/** Max pages sent through Vision OCR per upload (cost/latency guard). */
export const MAX_OCR_PAGES = Number(process.env.DOCAGENT_MAX_OCR_PAGES || 10);

export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
export const OPENROUTER_ANSWER_MODEL = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';
export const OCR_MODEL = process.env.GEMINI_OCR_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
