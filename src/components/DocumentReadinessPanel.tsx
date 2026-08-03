'use client';

import type { DocumentProcessingStatus, PageProcessingStats } from '@/lib/document-status';
import { OCR_FAILED_UI_MESSAGE, OCR_RECOVERY_SUGGESTIONS } from '@/lib/document-status';

export interface DocumentReadiness {
  status?: DocumentProcessingStatus;
  fileSize: number;
  textLength: number;
  pages?: number;
  totalChunks: number;
  embeddingsCreated: number;
  ocrUsed: boolean;
  grounded?: boolean;
  indexStatus: string;
  retrievalStatus: string;
  readinessCoverage?: number;
  pageCoveragePercent?: number;
  estimatedConfidence?: number;
  pageStats?: PageProcessingStats;
  warnings?: string[];
  errorCode?: string;
  userMessage?: string;
}

interface DocumentReadinessPanelProps {
  fileName: string;
  readiness: DocumentReadiness;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'ready' || normalized === 'passed' || normalized.includes('grounded')) return 'readiness-good';
  if (
    normalized.includes('warn') ||
    normalized.includes('weak') ||
    normalized.includes('limited') ||
    normalized.includes('ocr') ||
    normalized.includes('attention')
  ) {
    return 'readiness-warn';
  }
  return 'readiness-bad';
}

function badgeLabel(readiness: DocumentReadiness) {
  if (readiness.status === 'ocr_failed') return 'OCR Failed';
  if (readiness.status === 'needs_attention') return 'Needs Attention';
  if (readiness.status === 'limited') return 'Limited';
  if (readiness.status === 'ready_with_warnings') return 'Ready with warnings';
  if (readiness.status === 'ready' && readiness.grounded !== false) return 'Ready';
  if (readiness.status === 'failed') return 'Failed';
  return readiness.indexStatus || 'Unknown';
}

export type { DocumentProcessingStatus };

export default function DocumentReadinessPanel({ fileName, readiness }: DocumentReadinessPanelProps) {
  const failed =
    readiness.status === 'ocr_failed' ||
    readiness.status === 'failed' ||
    readiness.indexStatus === 'OCR Failed';
  const coverage = readiness.pageCoveragePercent ?? readiness.readinessCoverage ?? readiness.estimatedConfidence ?? 0;
  const stats = readiness.pageStats;
  const limited = readiness.status === 'limited';

  const metrics = failed
    ? [
        { label: 'File size', value: formatBytes(readiness.fileSize), helper: 'Upload payload' },
        { label: 'Extracted text', value: '0', helper: 'Characters read' },
        { label: 'Chunks', value: '0', helper: 'Not indexed' },
        { label: 'Embeddings', value: '0', helper: 'Not indexed' },
        { label: 'OCR used', value: readiness.ocrUsed ? 'Yes' : 'No', helper: 'Vision fallback' },
      ]
    : [
        { label: 'File size', value: formatBytes(readiness.fileSize), helper: 'Upload payload' },
        { label: 'Extracted text', value: formatNumber(readiness.textLength), helper: 'Characters read' },
        {
          label: 'Pages',
          value: stats
            ? `${stats.processedPages}/${stats.totalPages}`
            : readiness.pages
              ? formatNumber(readiness.pages)
              : 'N/A',
          helper: stats
            ? `${stats.nativeTextPages} native · ${stats.ocrPages} OCR · ${stats.ocrFailedPages ?? 0} OCR fail · ${stats.ocrSkippedPages ?? 0} skipped`
            : 'PDF/page signal',
        },
        { label: 'Chunks', value: formatNumber(readiness.totalChunks), helper: 'Retrieval units' },
        { label: 'Embeddings', value: formatNumber(readiness.embeddingsCreated), helper: 'Vector records' },
        { label: 'OCR used', value: readiness.ocrUsed ? 'Yes' : 'No', helper: 'Vision fallback' },
      ];

  return (
    <section className={`glass-card readiness-panel ${failed ? 'readiness-panel-failed' : ''} ${limited ? 'readiness-panel-limited' : ''}`}>
      <div className="readiness-glow" aria-hidden="true" />
      <div className="readiness-header">
        <div>
          <span className="eyebrow">Document Readiness</span>
          <h2>{failed ? 'Couldn’t index this file' : limited ? 'Limited coverage' : 'Index evaluation'}</h2>
          <p>{fileName}</p>
        </div>
        <span className={`readiness-badge ${statusClass(badgeLabel(readiness))}`}>
          <span />
          {badgeLabel(readiness)}
        </span>
      </div>

      {failed ? (
        <div className="readiness-failure-card">
          <p className="readiness-failure-title">
            {readiness.userMessage || 'We could not reliably read text from this file.'}
          </p>
          <p className="readiness-failure-copy">{OCR_FAILED_UI_MESSAGE}</p>
          <div className="readiness-tip-list" aria-label="Recovery suggestions">
            {OCR_RECOVERY_SUGGESTIONS.map((tip) => (
              <span key={tip} className="readiness-tip-chip">
                {tip}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <>
          {limited ? (
            <div className="readiness-limited-card">
              <p className="readiness-failure-title">
                {readiness.userMessage ||
                  (stats
                    ? `Only ${stats.processedPages} of ${stats.totalPages} pages were successfully processed.`
                    : 'Document coverage is limited.')}
              </p>
              <p className="readiness-failure-copy">Answers may only reflect processed pages — not the full document.</p>
            </div>
          ) : null}

          <div className="readiness-score-card">
            <div>
              <span>{stats ? 'Processing coverage' : 'Document readiness coverage'}</span>
              <strong>{coverage}%</strong>
            </div>
            <div className="readiness-progress" aria-hidden="true">
              <span style={{ width: `${coverage}%` }} />
            </div>
            <p className="readiness-score-note">
              Derived from extraction coverage, chunking, and indexing — not semantic accuracy.
            </p>
          </div>

          {readiness.warnings && readiness.warnings.length > 0 ? (
            <div className="readiness-warnings">
              {readiness.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <div className="readiness-status-row">
            <div>
              <span>Retrieval test</span>
              <strong className={statusClass(readiness.retrievalStatus)}>{readiness.retrievalStatus}</strong>
            </div>
            <div>
              <span>Index status</span>
              <strong className={statusClass(String(readiness.indexStatus))}>{readiness.indexStatus}</strong>
            </div>
          </div>
        </>
      )}

      <div className={`readiness-metric-grid ${failed ? 'readiness-metric-grid-compact' : ''}`}>
        {metrics.map((metric) => (
          <div className="readiness-metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.helper}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
