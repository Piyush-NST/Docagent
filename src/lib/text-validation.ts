/**
 * Shared validation for OCR / extraction output.
 * Rejects error placeholders, garbage, and non-document content.
 */

const FAILURE_PHRASES = [
  'no_readable_text',
  'could not extract text',
  'couldn\'t extract text',
  'unable to read image',
  'unable to extract',
  'no text detected',
  'no text found',
  'no readable text',
  'i can\'t read',
  'i cannot read',
  'cannot extract text',
  'nothing readable',
  'image appears blank',
  'no visible text',
  'sorry, i can\'t',
  'as an ai',
];

const MIN_TRIMMED_LENGTH = 12;
const MIN_ALPHA_NUM = 8;
const MIN_MEANINGFUL_RATIO = 0.45;

/** Letters (Latin + Devanagari) and digits */
const ALPHA_NUM_RE = /[A-Za-z0-9\u0900-\u097F]/g;
const SYMBOL_OR_SPACE_RE = /[^A-Za-z0-9\u0900-\u097F]/g;

export type TextValidationResult = {
  ok: boolean;
  reason?: string;
  cleanedText: string;
  alphaNumCount: number;
  meaningfulRatio: number;
};

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function looksLikeRepeatedGarbage(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 8) return false;

  // Same character repeated (e.g. "??????", ".....")
  if (/^(.)\1{7,}$/.test(compact)) return true;

  // Short token repeated many times
  const tokens = text.trim().split(/\s+/);
  if (tokens.length >= 4 && new Set(tokens.map((t) => t.toLowerCase())).size === 1) {
    return true;
  }

  return false;
}

function isMostlySymbols(text: string, alphaNumCount: number): boolean {
  const nonSpace = text.replace(/\s+/g, '');
  if (!nonSpace.length) return true;
  return alphaNumCount / nonSpace.length < MIN_MEANINGFUL_RATIO;
}

/**
 * Returns true only when `text` looks like real extracted document content.
 * Supports English and Hindi (Devanagari).
 */
export function isMeaningfulExtractedText(
  text: string,
  options?: { fileName?: string },
): TextValidationResult {
  const cleanedText = (text || '').replace(/\u0000/g, '').trim();
  const alphaNumMatches = cleanedText.match(ALPHA_NUM_RE) || [];
  const alphaNumCount = alphaNumMatches.length;
  const nonSpace = cleanedText.replace(/\s+/g, '');
  const meaningfulRatio = nonSpace.length ? alphaNumCount / nonSpace.length : 0;

  if (!cleanedText) {
    return { ok: false, reason: 'EMPTY', cleanedText: '', alphaNumCount: 0, meaningfulRatio: 0 };
  }

  const normalized = normalizeForCompare(cleanedText);

  if (normalized === 'no_readable_text' || normalized.includes('no_readable_text')) {
    return { ok: false, reason: 'NO_READABLE_TEXT', cleanedText: '', alphaNumCount, meaningfulRatio };
  }

  for (const phrase of FAILURE_PHRASES) {
    if (normalized === phrase || normalized.includes(phrase)) {
      return { ok: false, reason: 'OCR_ERROR_PHRASE', cleanedText: '', alphaNumCount, meaningfulRatio };
    }
  }

  if (options?.fileName) {
    const fileBase = options.fileName.replace(/\.[^.]+$/, '').toLowerCase().trim();
    if (fileBase && (normalized === fileBase || normalized === options.fileName.toLowerCase())) {
      return { ok: false, reason: 'FILENAME_ONLY', cleanedText: '', alphaNumCount, meaningfulRatio };
    }
  }

  if (cleanedText.length < MIN_TRIMMED_LENGTH) {
    return { ok: false, reason: 'TOO_SHORT', cleanedText: '', alphaNumCount, meaningfulRatio };
  }

  if (alphaNumCount < MIN_ALPHA_NUM) {
    return { ok: false, reason: 'TOO_FEW_ALPHA_NUM', cleanedText: '', alphaNumCount, meaningfulRatio };
  }

  if (isMostlySymbols(cleanedText, alphaNumCount)) {
    return { ok: false, reason: 'MOSTLY_SYMBOLS', cleanedText: '', alphaNumCount, meaningfulRatio };
  }

  if (looksLikeRepeatedGarbage(cleanedText)) {
    return { ok: false, reason: 'REPEATED_GARBAGE', cleanedText: '', alphaNumCount, meaningfulRatio };
  }

  // Strip [unclear] markers for a secondary length check after OCR retry
  const withoutUnclear = cleanedText.replace(/\[unclear\]/gi, '').replace(SYMBOL_OR_SPACE_RE, '').trim();
  if (withoutUnclear.length < MIN_ALPHA_NUM) {
    return { ok: false, reason: 'ONLY_UNCLEAR', cleanedText: '', alphaNumCount, meaningfulRatio };
  }

  return { ok: true, cleanedText, alphaNumCount, meaningfulRatio };
}
