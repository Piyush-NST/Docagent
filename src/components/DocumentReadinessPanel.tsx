'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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

type ReadinessTone = 'good' | 'warn' | 'bad';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function badgeLabel(readiness: DocumentReadiness) {
  if (readiness.status === 'ocr_failed') return 'OCR failed';
  if (readiness.status === 'needs_attention') return 'Needs attention';
  if (readiness.status === 'limited') return 'Limited';
  if (readiness.status === 'ready_with_warnings') return 'Ready with warnings';
  if (readiness.status === 'ready' && readiness.grounded !== false) return 'Ready';
  if (readiness.status === 'failed') return 'Failed';
  return readiness.indexStatus || 'Unknown';
}

function readinessTone(readiness: DocumentReadiness): ReadinessTone {
  if (readiness.status === 'ready' && readiness.grounded !== false) return 'good';
  if (
    readiness.status === 'ready_with_warnings' ||
    readiness.status === 'limited' ||
    readiness.status === 'needs_attention' ||
    readiness.status === 'processing'
  ) {
    return 'warn';
  }
  return 'bad';
}

function summaryContent(readiness: DocumentReadiness) {
  if (readiness.status === 'ocr_failed' || readiness.status === 'failed') {
    return {
      title: 'Couldn\'t process this file',
      copy: readiness.userMessage || 'Readable content could not be extracted from this document.',
    };
  }
  if (readiness.status === 'needs_attention') {
    return {
      title: 'Document needs attention',
      copy: readiness.userMessage || 'Processing did not produce a reliable document index.',
    };
  }
  if (readiness.status === 'limited') {
    return {
      title: 'Ready with limited coverage',
      copy: readiness.userMessage || 'Only part of this document is available for grounded answers.',
    };
  }
  if (readiness.status === 'ready_with_warnings') {
    return {
      title: 'Ready to chat',
      copy: 'Document processing completed with a few limitations.',
    };
  }
  if (readiness.status === 'processing') {
    return {
      title: 'Processing document',
      copy: readiness.userMessage || 'The document is still being prepared for grounded questions.',
    };
  }
  return {
    title: 'Ready to chat',
    copy: 'Document processed successfully.',
  };
}

function retrievalQuality(readiness: DocumentReadiness): {
  label: 'Strong' | 'Good' | 'Limited';
  tone: ReadinessTone;
  explanation: string;
} {
  if (
    readiness.retrievalStatus === 'Failed' ||
    readiness.status === 'failed' ||
    readiness.status === 'ocr_failed' ||
    readiness.status === 'needs_attention'
  ) {
    return {
      label: 'Limited',
      tone: 'bad',
      explanation: 'Reliable matching source passages are not available yet.',
    };
  }
  if (readiness.retrievalStatus === 'Weak' || readiness.status === 'limited') {
    return {
      label: 'Limited',
      tone: 'warn',
      explanation: 'Some questions may have fewer matching source passages.',
    };
  }
  if (readiness.status === 'ready_with_warnings') {
    return {
      label: 'Good',
      tone: 'warn',
      explanation: 'Source passages are available, though some document content may be incomplete.',
    };
  }
  return {
    label: 'Strong',
    tone: 'good',
    explanation: 'Source passages are indexed and ready for grounded answers.',
  };
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.5 8.25 2.75 2.75 6.25-6.25" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export type { DocumentProcessingStatus };

export default function DocumentReadinessPanel({ fileName, readiness }: DocumentReadinessPanelProps) {
  const [detailsState, setDetailsState] = useState({ fileName, open: false });
  const detailsOpen = detailsState.fileName === fileName && detailsState.open;
  const failed = readiness.status === 'ocr_failed' || readiness.status === 'failed';
  const coverage = Math.max(
    0,
    Math.min(
      100,
      readiness.pageCoveragePercent ?? readiness.readinessCoverage ?? readiness.estimatedConfidence ?? 0,
    ),
  );
  const stats = readiness.pageStats;
  const totalPages = stats?.totalPages ?? readiness.pages;
  const summary = summaryContent(readiness);
  const quality = retrievalQuality(readiness);
  const tone = readinessTone(readiness);
  const pagesLabel = totalPages ? `${formatNumber(totalPages)} ${totalPages === 1 ? 'page' : 'pages'}` : 'Pages unavailable';
  const processedPages = stats
    ? `${formatNumber(stats.processedPages)} / ${formatNumber(stats.totalPages)}`
    : totalPages
      ? `${formatNumber(totalPages)} / ${formatNumber(totalPages)}`
      : 'Unavailable';

  const technicalDetails = [
    ['Extracted text', `${formatNumber(readiness.textLength)} characters`],
    ['Retrieval chunks', formatNumber(readiness.totalChunks)],
    ['Vector records', formatNumber(readiness.embeddingsCreated)],
    ['OCR', readiness.ocrUsed ? 'Vision fallback used' : 'Not required'],
    ['Pages processed', processedPages],
    ['Index result', readiness.indexStatus],
    ['Retrieval result', readiness.retrievalStatus],
  ];

  if (stats) {
    technicalDetails.push(
      ['Native text pages', formatNumber(stats.nativeTextPages)],
      ['OCR pages', formatNumber(stats.ocrPages)],
      ['OCR failures', formatNumber(stats.ocrFailedPages ?? 0)],
      ['Skipped pages', formatNumber(stats.ocrSkippedPages ?? 0)],
    );
  }

  return (
    <section className={`glass-card readiness-panel readiness-panel-${tone}`}>
      <header className="readiness-header">
        <div className="readiness-header-copy">
          <span className="eyebrow">Document Readiness</span>
          <p title={fileName}>{fileName}</p>
        </div>
        <span className={`readiness-badge readiness-tone-${tone}`} role="status">
          <span aria-hidden="true" />
          {badgeLabel(readiness)}
        </span>
      </header>

      <div className="readiness-summary">
        <div className="readiness-summary-intro">
          <h2>{summary.title}</h2>
          <p>{summary.copy}</p>
        </div>

        <ul className="readiness-meta-row" aria-label="Document processing summary">
          <li className={`readiness-coverage readiness-tone-${tone}`}>
            {coverage > 0 && !failed ? (
              <CheckIcon />
            ) : (
              <span className="readiness-coverage-mark" aria-hidden="true">!</span>
            )}
            {coverage}% processed
          </li>
          <li>{pagesLabel}</li>
          <li>{readiness.ocrUsed ? 'OCR used' : 'OCR not needed'}</li>
          <li>{formatBytes(readiness.fileSize)}</li>
        </ul>

        <div className="readiness-quality-row">
          <div>
            <span>Retrieval quality</span>
            <strong className={`readiness-quality readiness-tone-${quality.tone}`}>
              <span aria-hidden="true" />
              {quality.label}
            </strong>
          </div>
          <p>{quality.explanation}</p>
        </div>

        {failed ? (
          <div className="readiness-recovery">
            <p>{OCR_FAILED_UI_MESSAGE}</p>
            <div className="readiness-tip-list" aria-label="Recovery suggestions">
              {OCR_RECOVERY_SUGGESTIONS.map((tip) => (
                <span key={tip} className="readiness-tip-chip">
                  {tip}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="readiness-details">
        <button
          className="readiness-details-toggle"
          type="button"
          onClick={() => setDetailsState({ fileName, open: !detailsOpen })}
          aria-expanded={detailsOpen}
          aria-controls="readiness-technical-details"
        >
          <span>{detailsOpen ? 'Hide processing details' : 'View processing details'}</span>
          <motion.span animate={{ rotate: detailsOpen ? 180 : 0 }} transition={{ duration: 0.18 }}>
            <ChevronIcon />
          </motion.span>
        </button>

        <AnimatePresence initial={false}>
          {detailsOpen ? (
            <motion.div
              id="readiness-technical-details"
              className="readiness-details-content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <dl>
                {technicalDetails.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {readiness.warnings?.length ? (
                <div className="readiness-detail-notes">
                  <span>Processing notes</span>
                  {readiness.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}
