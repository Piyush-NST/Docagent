'use client';

import React from 'react';

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

  return (
    <div className={`premium-toast premium-toast-${type}`} role={isError ? 'alert' : 'status'} aria-live="polite">
      <div className="premium-toast-shell">
        <span className="premium-toast-icon" aria-hidden="true">
          {isError ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 8v5" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m20 6-11 11-5-5" />
            </svg>
          )}
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
                  File <b>{fileSizeLabel}</b>
                </span>
              )}
              {limitLabel && (
                <span>
                  Limit <b>{limitLabel}</b>
                </span>
              )}
            </div>
          )}

          {details && <small>{details}</small>}
        </div>
      </div>
    </div>
  );
}
