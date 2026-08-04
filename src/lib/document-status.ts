import { READINESS_THRESHOLDS } from '@/lib/config/readiness';

export type DocumentProcessingStatus =
  | 'processing'
  | 'ready'
  | 'ready_with_warnings'
  | 'limited'
  | 'ocr_failed'
  | 'needs_attention'
  | 'failed';

export type DocumentErrorCode =
  | 'NO_READABLE_TEXT'
  | 'OCR_ERROR_PHRASE'
  | 'OCR_ACCESS_DENIED'
  | 'OCR_INVALID_API_KEY'
  | 'OCR_QUOTA_EXCEEDED'
  | 'OCR_RATE_LIMITED'
  | 'OCR_PROVIDER_UNAVAILABLE'
  | 'TOO_SHORT'
  | 'TOO_FEW_ALPHA_NUM'
  | 'MOSTLY_SYMBOLS'
  | 'REPEATED_GARBAGE'
  | 'ONLY_UNCLEAR'
  | 'FILENAME_ONLY'
  | 'EMPTY'
  | 'PROCESSING_ERROR'
  | 'PASSWORD_PROTECTED'
  | 'UNSUPPORTED_TYPE'
  | 'CORRUPT_DOCUMENT'
  | 'PARTIAL_EXTRACTION'
  | 'LIMITED_COVERAGE';

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

export interface PageProcessingStats {
  totalPages: number;
  processedPages: number;
  nativeTextPages: number;
  ocrPages: number;
  ocrFailedPages: number;
  ocrSkippedPages: number;
  /** Convenience: failed OCR attempts + skipped due to budget (not usable). */
  failedPages: number;
  warnings: string[];
}

export interface DocumentReadinessPayload {
  status: DocumentProcessingStatus;
  extractedTextLength: number;
  chunksCreated: number;
  embeddingsCreated: number;
  ocrUsed: boolean;
  grounded: boolean;
  pages?: number;
  fileSize: number;
  indexStatus: 'Ready' | 'Ready with warnings' | 'Limited' | 'Failed' | 'OCR Failed' | 'Needs Attention';
  retrievalStatus: 'Passed' | 'Weak' | 'Failed';
  /** Deterministic processing coverage 0–100. Not semantic accuracy. */
  readinessCoverage: number;
  /** Page-usable coverage 0–100 when page stats exist. */
  pageCoveragePercent?: number;
  pageStats?: PageProcessingStats;
  errorCode?: DocumentErrorCode | string;
  userMessage?: string;
  warnings?: string[];
}

export function isDocumentQueryable(status: DocumentProcessingStatus): boolean {
  return status === 'ready' || status === 'ready_with_warnings' || status === 'limited';
}

/** @deprecated use isDocumentQueryable */
export function isDocumentReady(status: DocumentProcessingStatus): boolean {
  return isDocumentQueryable(status);
}

export function computePageCoveragePercent(pageStats?: PageProcessingStats): number | undefined {
  if (!pageStats || pageStats.totalPages <= 0) return undefined;
  return Math.round((pageStats.processedPages / pageStats.totalPages) * 100);
}

export function computeReadinessCoverage(args: {
  textLength: number;
  chunksCreated: number;
  embeddingsCreated: number;
  pageStats?: PageProcessingStats;
}): number {
  let score = 0;

  if (args.textLength > 0) score += 25;
  if (args.textLength >= READINESS_THRESHOLDS.strongTextLength) score += 15;
  if (args.chunksCreated > 0) score += 20;
  if (args.embeddingsCreated > 0 && args.embeddingsCreated === args.chunksCreated) score += 20;
  else if (args.embeddingsCreated > 0) score += 10;

  if (args.pageStats && args.pageStats.totalPages > 0) {
    const coverage = args.pageStats.processedPages / args.pageStats.totalPages;
    score += Math.round(coverage * 20);
    const unresolved = args.pageStats.ocrFailedPages + args.pageStats.ocrSkippedPages;
    if (unresolved > 0) score -= Math.min(15, unresolved * 2);
  } else {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

function resolveStatusFromCoverage(args: {
  retrievalFailed: boolean;
  pageStats?: PageProcessingStats;
  warningCount: number;
}): DocumentProcessingStatus {
  if (args.retrievalFailed) return 'needs_attention';

  const pageStats = args.pageStats;
  if (pageStats && pageStats.totalPages > 0) {
    const ratio = pageStats.processedPages / pageStats.totalPages;
    if (ratio < READINESS_THRESHOLDS.limitedMinPageCoverage) {
      return pageStats.processedPages > 0 ? 'limited' : 'failed';
    }
    if (ratio < READINESS_THRESHOLDS.warningMinPageCoverage) return 'limited';
    if (ratio < READINESS_THRESHOLDS.readyMinPageCoverage || args.warningCount > 0) {
      return 'ready_with_warnings';
    }
    return 'ready';
  }

  // Non-page docs (DOCX/images already validated): warnings only
  return args.warningCount > 0 ? 'ready_with_warnings' : 'ready';
}

export function buildFailedOcrReadiness(args: {
  fileSize: number;
  ocrUsed: boolean;
  pages?: number;
  errorCode?: string;
  userMessage?: string;
  pageStats?: PageProcessingStats;
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
    readinessCoverage: 0,
    pageCoveragePercent: computePageCoveragePercent(args.pageStats),
    pageStats: args.pageStats,
    errorCode: args.errorCode || 'NO_READABLE_TEXT',
    userMessage: args.userMessage || OCR_FAILED_USER_MESSAGE,
    warnings: args.pageStats?.warnings,
  };
}

export function buildReadyReadiness(args: {
  fileSize: number;
  textLength: number;
  chunksCreated: number;
  embeddingsCreated: number;
  ocrUsed: boolean;
  pages?: number;
  pageStats?: PageProcessingStats;
  warnings?: string[];
}): DocumentReadinessPayload {
  const warnings = [...(args.warnings || []), ...(args.pageStats?.warnings || [])];
  const stats = args.pageStats;

  if (stats && stats.ocrSkippedPages > 0) {
    warnings.push(
      `${stats.ocrSkippedPages} page(s) were skipped due to the OCR processing budget.`,
    );
  }
  if (stats && stats.ocrFailedPages > 0) {
    warnings.push(`${stats.ocrFailedPages} page(s) failed OCR with no usable text.`);
  }
  if (stats && stats.processedPages > 0 && stats.processedPages < stats.totalPages) {
    warnings.push(
      `Only ${stats.processedPages} of ${stats.totalPages} pages were successfully processed.`,
    );
  }

  const uniqueWarnings = Array.from(new Set(warnings));

  const retrievalStatus =
    args.chunksCreated === 0
      ? 'Failed'
      : args.embeddingsCreated === 0 || args.embeddingsCreated < args.chunksCreated || args.textLength < READINESS_THRESHOLDS.strongTextLength
        ? 'Weak'
        : 'Passed';

  const status = resolveStatusFromCoverage({
    retrievalFailed: retrievalStatus === 'Failed',
    pageStats: stats,
    warningCount: uniqueWarnings.length,
  });

  const readinessCoverage = computeReadinessCoverage({
    textLength: args.textLength,
    chunksCreated: args.chunksCreated,
    embeddingsCreated: args.embeddingsCreated,
    pageStats: args.pageStats,
  });

  const pageCoveragePercent = computePageCoveragePercent(args.pageStats);

  const indexStatus: DocumentReadinessPayload['indexStatus'] =
    status === 'limited'
      ? 'Limited'
      : status === 'ready_with_warnings'
        ? 'Ready with warnings'
        : status === 'needs_attention' || status === 'failed'
          ? 'Failed'
          : args.chunksCreated > 0
            ? 'Ready'
            : 'Failed';

  let userMessage: string | undefined;
  if (status === 'limited' && stats) {
    userMessage = `Limited document coverage: ${stats.processedPages} of ${stats.totalPages} pages processed. Answers may only reflect processed pages.`;
  }

  return {
    status,
    extractedTextLength: args.textLength,
    chunksCreated: args.chunksCreated,
    embeddingsCreated: args.embeddingsCreated,
    ocrUsed: args.ocrUsed,
    grounded: retrievalStatus !== 'Failed' && isDocumentQueryable(status),
    pages: args.pages,
    fileSize: args.fileSize,
    indexStatus,
    retrievalStatus,
    readinessCoverage,
    pageCoveragePercent,
    pageStats: args.pageStats,
    warnings: uniqueWarnings.length ? uniqueWarnings : undefined,
    userMessage,
    errorCode: status === 'limited' ? 'LIMITED_COVERAGE' : undefined,
  };
}

export function coverageLabelFromReadiness(readiness?: DocumentReadinessPayload): string | undefined {
  const stats = readiness?.pageStats;
  if (!stats || stats.totalPages <= 0) return undefined;
  return `Only ${stats.processedPages} of ${stats.totalPages} pages were successfully processed (${computePageCoveragePercent(stats)}% coverage).`;
}
