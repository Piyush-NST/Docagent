'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

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

  const errorIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );

  const successIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );

  const closeIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );

  const content = isError ? (
    <motion.div
      className="upload-modal-backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <motion.section
        className="premium-alert-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="premium-alert-title"
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="premium-alert-glow" aria-hidden />

        <button type="button" className="premium-alert-close" onClick={onDismiss} aria-label="Dismiss message">
          {closeIcon}
        </button>

        <div className="premium-alert-header">
          <span className="premium-alert-icon premium-alert-icon-error" aria-hidden="true">
            {errorIcon}
          </span>
          <strong id="premium-alert-title">{title}</strong>
        </div>

        <p className="premium-alert-message">{message}</p>

        {(fileSizeLabel || limitLabel) && (
          <div className="premium-alert-chips" aria-label="Upload file size details">
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

        {details && <p className="premium-alert-details">{details}</p>}

        <div className="premium-alert-actions">
          <button type="button" className="premium-alert-btn" onClick={onDismiss}>
            Got it
          </button>
        </div>
      </motion.section>
    </motion.div>
  ) : (
    <motion.div
      className="premium-toast premium-toast-success"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="premium-toast-shell">
        <span className="premium-toast-icon" aria-hidden="true">
          {successIcon}
        </span>

        <div className="premium-toast-content">
          <div className="premium-toast-heading">
            <strong>{title}</strong>
            <button type="button" className="premium-toast-close" onClick={onDismiss} aria-label="Dismiss notification">
              {closeIcon}
            </button>
          </div>
          <p>{message}</p>
          {details && <small>{details}</small>}
        </div>
      </div>
    </motion.div>
  );

  return createPortal(<AnimatePresence mode="wait">{content}</AnimatePresence>, document.body);
}
