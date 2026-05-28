'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface UploadToastNoticeProps {
  type: 'success' | 'error';
  title: string;
  message: string;
  details?: string;
  fileSizeLabel?: string;
  limitLabel?: string;
  onDismiss: () => void;
}

export default function UploadToastNotice({
  type,
  title,
  message,
  details,
  fileSizeLabel,
  limitLabel,
  onDismiss,
}: UploadToastNoticeProps) {
  const isError = type === 'error';

  useEffect(() => {
    if (!isError) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isError, onDismiss]);

  if (typeof document === 'undefined') return null;

  const icon = isError ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 8v5" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m20 6-11 11-5-5" />
    </svg>
  );

  const content = isError ? (
    <div
      className="upload-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <section className="upload-limit-modal" role="alertdialog" aria-modal="true" aria-labelledby="upload-limit-title">
        <button type="button" className="upload-limit-close" onClick={onDismiss} aria-label="Dismiss upload limit message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>

        <div className="upload-limit-icon" aria-hidden="true">
          {icon}
        </div>

        <div className="upload-limit-content">
          <strong id="upload-limit-title">{title}</strong>
          <p>{message}</p>

          {(fileSizeLabel || limitLabel) && (
            <div className="upload-limit-chips" aria-label="Upload file size limit">
              {fileSizeLabel && (
                <span>
                  File: <b>{fileSizeLabel}</b>
                </span>
              )}
              {limitLabel && (
                <span>
                  Limit: <b>{limitLabel}</b>
                </span>
              )}
            </div>
          )}

          {details && <small>{details}</small>}
        </div>
      </section>
    </div>
  ) : (
    <div className={`premium-toast premium-toast-${type}`} role={isError ? 'alert' : 'status'} aria-live="polite">
      <div className="premium-toast-shell">
        <span className="premium-toast-icon" aria-hidden="true">
          {icon}
        </span>

        <div className="premium-toast-content">
          <div className="premium-toast-heading">
            <strong>{title}</strong>
            <button type="button" className="premium-toast-close" onClick={onDismiss} aria-label="Dismiss upload notification">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          <p>{message}</p>

          {(fileSizeLabel || limitLabel) && (
            <div className="premium-toast-metrics" aria-label="Upload file size limit">
              {fileSizeLabel && (
                <span>
                  File: <b>{fileSizeLabel}</b>
                </span>
              )}
              {limitLabel && (
                <span>
                  Limit: <b>{limitLabel}</b>
                </span>
              )}
            </div>
          )}

          {details && <small>{details}</small>}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
