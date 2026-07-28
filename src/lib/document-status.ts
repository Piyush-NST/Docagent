export type DocumentProcessingStatus =
  | 'processing'
  | 'ready'
  | 'ocr_failed'
  | 'needs_attention'
  | 'failed';

export type DocumentErrorCode =
  | 'NO_READABLE_TEXT'
  | 'OCR_ERROR_PHRASE'
  | 'TOO_SHORT'
  | 'TOO_FEW_ALPHA_NUM'
  | 'MOSTLY_SYMBOLS'
  | 'REPEATED_GARBAGE'
  | 'ONLY_UNCLEAR'
  | 'FILENAME_ONLY'
  | 'EMPTY'
  | 'PROCESSING_ERROR';

export const OCR_FAILED_USER_MESSAGE =
  'We could not reliably read text from this image.';

export const OCR_FAILED_UI_MESSAGE =
  'We couldn’t reliably read this image. It may be blurry, handwritten, low contrast or cropped incorrectly.';

export const OCR_RECOVERY_SUGGESTIONS = [
  'Upload a clearer image',
  'Crop the relevant area',
  'Improve lighting and contrast',
  'Upload a PDF or typed version',
] as const;

export interface DocumentReadinessPayload {
  status: DocumentProcessingStatus;
  extractedTextLength: number;
  chunksCreated: number;
  embeddingsCreated: number;
  ocrUsed: boolean;
  grounded: boolean;
  pages?: number;
  fileSize: number;
  indexStatus: 'Ready' | 'Failed' | 'OCR Failed' | 'Needs Attention';
  retrievalStatus: 'Passed' | 'Weak' | 'Failed';
  estimatedConfidence: number;
  errorCode?: DocumentErrorCode | string;
  userMessage?: string;
}

export function isDocumentReady(status: DocumentProcessingStatus): boolean {
  return status === 'ready';
}

export function buildFailedOcrReadiness(args: {
  fileSize: number;
  ocrUsed: boolean;
  pages?: number;
  errorCode?: string;
  userMessage?: string;
}): DocumentReadinessPayload {
  return {
    status: 'ocr_failed',
    extractedTextLength: 0,
    chunksCreated: 0,
    embeddingsCreated: 0,
    ocrUsed: args.ocrUsed,
    grounded: false,
    pages: args.pages,
    fileSize: args.fileSize,
    indexStatus: 'OCR Failed',
    retrievalStatus: 'Failed',
    estimatedConfidence: 0,
    errorCode: args.errorCode || 'NO_READABLE_TEXT',
    userMessage: args.userMessage || OCR_FAILED_USER_MESSAGE,
  };
}

export function buildReadyReadiness(args: {
  fileSize: number;
  textLength: number;
  chunksCreated: number;
  embeddingsCreated: number;
  ocrUsed: boolean;
  pages?: number;
}): DocumentReadinessPayload {
  const retrievalStatus =
    args.chunksCreated === 0 || args.embeddingsCreated === 0
      ? 'Failed'
      : args.embeddingsCreated < args.chunksCreated || args.textLength < 180
        ? 'Weak'
        : 'Passed';

  let score = retrievalStatus === 'Passed' ? 62 : retrievalStatus === 'Weak' ? 38 : 12;
  score += Math.min(18, Math.floor(args.textLength / 900) * 3);
  score += Math.min(12, args.chunksCreated * 2);
  score += args.embeddingsCreated >= args.chunksCreated ? 8 : -8;

  return {
    status: retrievalStatus === 'Failed' ? 'needs_attention' : 'ready',
    extractedTextLength: args.textLength,
    chunksCreated: args.chunksCreated,
    embeddingsCreated: args.embeddingsCreated,
    ocrUsed: args.ocrUsed,
    grounded: retrievalStatus !== 'Failed',
    pages: args.pages,
    fileSize: args.fileSize,
    indexStatus: args.embeddingsCreated === args.chunksCreated && args.chunksCreated > 0 ? 'Ready' : 'Failed',
    retrievalStatus,
    estimatedConfidence: Math.max(0, Math.min(96, score)),
  };
}
