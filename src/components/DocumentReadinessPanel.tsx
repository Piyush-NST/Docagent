'use client';

import type { DocumentProcessingStatus } from '@/lib/document-status';
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
  indexStatus: 'Ready' | 'Failed' | 'OCR Failed' | 'Needs Attention' | string;
  retrievalStatus: 'Passed' | 'Weak' | 'Failed' | string;
  estimatedConfidence: number;
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
  if (normalized === 'ready' || normalized === 'passed') return 'readiness-good';
  if (
    normalized === 'weak' ||
    normalized === 'needs attention' ||
    normalized === 'needs_attention' ||
    normalized === 'ocr failed' ||
    normalized === 'ocr_failed'
  ) {
    return 'readiness-warn';
  }
  return 'readiness-bad';
}

function badgeLabel(readiness: DocumentReadiness) {
  if (readiness.status === 'ocr_failed') return 'OCR Failed';
  if (readiness.status === 'needs_attention') return 'Needs Attention';
  if (readiness.status === 'ready' && readiness.grounded !== false) return 'Grounded';
  return readiness.indexStatus;
}

export type { DocumentProcessingStatus };

export default function DocumentReadinessPanel({
  fileName,
  readiness,
}: DocumentReadinessPanelProps) {
  const failed = readiness.status === 'ocr_failed' || readiness.indexStatus === 'OCR Failed';

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
          label: 'Pages detected',
          value: readiness.pages ? formatNumber(readiness.pages) : 'N/A',
          helper: 'PDF/page signal',
        },
        { label: 'Chunks created', value: formatNumber(readiness.totalChunks), helper: 'Retrieval units' },
        { label: 'Embeddings', value: formatNumber(readiness.embeddingsCreated), helper: 'Vector records' },
        { label: 'OCR used', value: readiness.ocrUsed ? 'Yes' : 'No', helper: 'Vision fallback' },
      ];

  return (
    <section className={`glass-card readiness-panel ${failed ? 'readiness-panel-failed' : ''}`}>
      <div className="readiness-glow" aria-hidden="true" />
      <div className="readiness-header">
        <div>
          <span className="eyebrow">Document Readiness</span>
          <h2>{failed ? 'Couldn’t index this file' : 'Index evaluation'}</h2>
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
            {readiness.userMessage || 'We could not reliably read text from this image.'}
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
          <div className="readiness-score-card">
            <div>
              <span>Estimated answer confidence</span>
              <strong>{readiness.estimatedConfidence}%</strong>
            </div>
            <div className="readiness-progress" aria-hidden="true">
              <span style={{ width: `${readiness.estimatedConfidence}%` }} />
            </div>
          </div>

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
