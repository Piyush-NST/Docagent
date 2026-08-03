'use client';

import React, { useEffect, useMemo, useState } from 'react';

export interface AnalysisStep {
  label: string;
  detail?: string;
}

export type ProcessingUiState =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'ocr_active'
  | 'embeddings_active'
  | 'ready'
  | 'ready_with_warnings'
  | 'limited'
  | 'failed';

interface DocumentAnalysisLoaderProps {
  steps: AnalysisStep[];
  title?: string;
  mode?: 'upload' | 'chat';
  error?: string | null;
  fileName?: string;
  /** Optional explicit pipeline state. Defaults from error / step progress. */
  status?: ProcessingUiState;
}

const STATUS_META: Record<
  Exclude<ProcessingUiState, 'idle'>,
  { badge: string; tone: 'neutral' | 'active' | 'success' | 'warning' | 'danger' }
> = {
  uploading: { badge: 'Uploading', tone: 'active' },
  processing: { badge: 'Processing', tone: 'active' },
  ocr_active: { badge: 'OCR active', tone: 'active' },
  embeddings_active: { badge: 'Indexing', tone: 'active' },
  ready: { badge: 'Ready', tone: 'success' },
  ready_with_warnings: { badge: 'Ready with warnings', tone: 'warning' },
  limited: { badge: 'Limited coverage', tone: 'warning' },
  failed: { badge: 'Failed', tone: 'danger' },
};

function inferStatus(
  error: string | null | undefined,
  activeStep: number,
  steps: AnalysisStep[],
  explicit?: ProcessingUiState,
): ProcessingUiState {
  if (explicit && explicit !== 'idle') return explicit;
  if (error) return 'failed';

  const label = (steps[activeStep]?.label || '').toLowerCase();
  if (label.includes('upload')) return 'uploading';
  if (label.includes('ocr')) return 'ocr_active';
  if (label.includes('embedding') || label.includes('index')) return 'embeddings_active';
  if (activeStep <= 0) return 'uploading';
  if (activeStep >= steps.length - 1) return 'embeddings_active';
  return 'processing';
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DocumentAnalysisLoader({
  steps,
  title = 'Preparing your document',
  mode = 'upload',
  error,
  fileName,
  status: statusProp,
}: DocumentAnalysisLoaderProps) {
  const stepKey = `${fileName || ''}:${steps.map((s) => s.label).join('|')}`;
  const [activeStep, setActiveStep] = useState(0);
  const [trackedKey, setTrackedKey] = useState(stepKey);
  if (trackedKey !== stepKey) {
    setTrackedKey(stepKey);
    setActiveStep(0);
  }

  useEffect(() => {
    if (
      error ||
      statusProp === 'ready' ||
      statusProp === 'ready_with_warnings' ||
      statusProp === 'limited' ||
      statusProp === 'failed'
    ) {
      return;
    }
    if (steps.length < 2) return;

    const interval = window.setInterval(() => {
      setActiveStep((current) => {
        if (current >= steps.length - 1) return current;
        return current + 1;
      });
    }, mode === 'chat' ? 1100 : 1300);

    return () => window.clearInterval(interval);
  }, [error, mode, steps.length, statusProp, stepKey]);

  const status = useMemo(
    () => inferStatus(error, activeStep, steps, statusProp),
    [activeStep, error, statusProp, steps],
  );

  const meta = STATUS_META[status === 'idle' ? 'processing' : status];
  const isTerminal =
    status === 'ready' ||
    status === 'ready_with_warnings' ||
    status === 'limited' ||
    status === 'failed';

  const progress = isTerminal
    ? 100
    : Math.min(96, ((activeStep + 1) / Math.max(steps.length, 1)) * 100);

  const detail =
    error ||
    (status === 'ready'
      ? 'Document is indexed and ready for grounded questions.'
      : status === 'ready_with_warnings'
        ? 'Document is usable, but some pages may be incomplete.'
        : status === 'limited'
          ? 'Only part of the document was processed. Answers may be incomplete.'
          : status === 'failed'
            ? 'Processing stopped before the document became ready.'
            : steps[activeStep]?.detail || steps[activeStep]?.label || 'Working…');

  const heading =
    status === 'failed'
      ? 'Processing failed'
      : status === 'ready'
        ? 'Document ready'
        : status === 'ready_with_warnings'
          ? 'Ready with warnings'
          : status === 'limited'
            ? 'Limited coverage'
            : title;

  return (
    <div
      className={`proc-panel proc-panel-${mode} proc-tone-${meta.tone} ${status === 'failed' ? 'proc-panel-error' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!isTerminal}
    >
      <div className="proc-panel-header">
        <div className="proc-panel-titles">
          <span className={`proc-badge proc-badge-${meta.tone}`}>{meta.badge}</span>
          <strong className="proc-title">{heading}</strong>
          {fileName ? <p className="proc-filename">{fileName}</p> : null}
          <p className="proc-detail">{detail}</p>
        </div>
        {!isTerminal ? (
          <span className="proc-spinner" aria-hidden="true" />
        ) : status === 'failed' ? (
          <span className="proc-terminal-icon proc-terminal-fail" aria-hidden="true">
            !
          </span>
        ) : (
          <span className="proc-terminal-icon proc-terminal-ok" aria-hidden="true">
            <CheckIcon />
          </span>
        )}
      </div>

      <div className="proc-progress-row">
        <div
          className="proc-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label="Processing progress"
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="proc-progress-label">{Math.round(progress)}%</span>
      </div>

      <ol className="proc-timeline">
        {steps.map((step, index) => {
          const isDone =
            status === 'failed'
              ? index < activeStep
              : isTerminal
                ? true
                : !error && index < activeStep;
          const isActive = !isTerminal && !error && index === activeStep;
          const isPending = !isDone && !isActive;

          return (
            <li
              key={step.label}
              className={`proc-step ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''} ${isPending ? 'is-pending' : ''}`}
            >
              <span className="proc-step-marker" aria-hidden="true">
                {isDone ? <CheckIcon /> : isActive ? <span className="proc-step-pulse" /> : index + 1}
              </span>
              <div className="proc-step-copy">
                <span className="proc-step-label">{step.label}</span>
                {isActive && step.detail ? <span className="proc-step-hint">{step.detail}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
