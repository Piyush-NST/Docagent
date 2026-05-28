'use client';

import React, { useCallback, useState } from 'react';
import UploadToastNotice from './UploadToastNotice';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  SUPPORTED_UPLOAD_LABEL,
  buildOversizedFileMessage,
  formatBytes,
} from '@/lib/upload-limits';

interface UploadedDocument {
  documentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  processing: {
    totalChunks: number;
    pages?: number;
    textLength: number;
  };
}

interface DocumentUploadProps {
  onDocumentUploaded: (doc: UploadedDocument) => void;
}

interface UploadToast {
  type: 'success' | 'error';
  title: string;
  message: string;
  details?: string;
  fileSizeLabel?: string;
  limitLabel?: string;
}

const loadingMessages = [
  'Uploading document...',
  'Analyzing document...',
  'Extracting context...',
  'Preparing grounded answers...',
];

function getUserFriendlyError(error: string): UploadToast {
  const errorMap: Record<string, string> = {
    'No text in document': 'Could not extract text from this file. Please try a different document.',
    'No text found': 'No readable text found in this image. Please try a clearer image.',
    Unsupported: `This file type is not supported. Please upload ${SUPPORTED_UPLOAD_LABEL} files.`,
    GROQ_API_KEY: 'Service temporarily unavailable. Please try again later.',
    GEMINI_API_KEY: 'Service temporarily unavailable. Please try again later.',
    OPENAI_API_KEY: 'Service temporarily unavailable. Please try again later.',
    quota: 'Service limit reached. Please try again later.',
    'rate limit': 'Too many requests. Please wait a moment and try again.',
    '429': 'Too many requests. Please wait a moment and try again.',
    '500': 'Something went wrong on our end. Please try again.',
    '503': 'Service temporarily unavailable. Please try again later.',
    network: 'Network error. Please check your connection.',
    timeout: 'Request timed out. Please try again.',
    FILE_TOO_LARGE: `This file is above the ${MAX_UPLOAD_LABEL} processing limit.`,
    'File too large': `This file is above the ${MAX_UPLOAD_LABEL} processing limit.`,
    'extract text': 'Could not read this document. Please try a different file.',
  };

  const lowerError = error.toLowerCase();

  for (const [key, message] of Object.entries(errorMap)) {
    if (lowerError.includes(key.toLowerCase())) {
      return {
        type: 'error',
        title: key.toLowerCase().includes('large') || key === 'FILE_TOO_LARGE' ? 'File limit reached' : 'Upload failed',
        message,
        details: key.toLowerCase().includes('large') || key === 'FILE_TOO_LARGE' ? undefined : `Supported uploads: ${SUPPORTED_UPLOAD_LABEL}, up to ${MAX_UPLOAD_LABEL}.`,
        limitLabel: MAX_UPLOAD_LABEL,
      };
    }
  }

  return {
    type: 'error',
    title: 'Upload failed',
    message: 'Something went wrong. Please try again with a different file.',
    details: `Supported uploads: ${SUPPORTED_UPLOAD_LABEL}, up to ${MAX_UPLOAD_LABEL}.`,
    limitLabel: MAX_UPLOAD_LABEL,
  };
}

export default function DocumentUpload({ onDocumentUploaded }: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState<UploadToast | null>(null);
  const [status, setStatus] = useState(loadingMessages[0]);

  const showToast = (nextToast: UploadToast) => {
    setToast(nextToast);
    setTimeout(() => setToast(null), nextToast.type === 'error' ? 7200 : 4200);
  };

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const uploadFile = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast({
        type: 'error',
        title: 'File limit reached',
        message: buildOversizedFileMessage(file.name, file.size),
        fileSizeLabel: formatBytes(file.size),
        limitLabel: MAX_UPLOAD_LABEL,
      });
      return;
    }

    setIsUploading(true);
    setToast(null);
    setStatus(loadingMessages[0]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      setStatus(loadingMessages[1]);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      setStatus(loadingMessages[2]);
      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'FILE_TOO_LARGE') {
          showToast({
            type: 'error',
            title: 'File limit reached',
            message: data.message || buildOversizedFileMessage(file.name, file.size),
            fileSizeLabel: data.actualSizeLabel || formatBytes(file.size),
            limitLabel: data.maxSize || MAX_UPLOAD_LABEL,
          });
          return;
        }

        throw new Error(data.message || data.error || 'Upload failed');
      }

      setStatus(loadingMessages[3]);
      showToast({
        type: 'success',
        title: 'Document ready',
        message: `"${file.name}" is indexed and ready to chat.`,
      });
      onDocumentUploaded(data);
    } catch (err) {
      console.error('Upload error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Upload failed';
      showToast(getUserFriendlyError(errorMsg));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    if (files.length > 0) uploadFile(files[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) uploadFile(files[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="glass-card upload-card">
      {toast && (
        <UploadToastNotice
          type={toast.type}
          title={toast.title}
          message={toast.message}
          details={toast.details}
          fileSizeLabel={toast.fileSizeLabel}
          limitLabel={toast.limitLabel}
          onDismiss={() => setToast(null)}
        />
      )}

      <div className="section-heading">
        <span className="eyebrow">Step 01</span>
        <h2>Upload Document</h2>
        <p>Drop a file into the assistant workspace.</p>
      </div>

      <div
        className={`upload-zone ${isDragging ? 'dragover' : ''} ${isUploading ? 'uploading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            document.getElementById('file-input')?.click();
          }
        }}
      >
        <input
          type="file"
          id="file-input"
          accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
          onChange={handleFileSelect}
          className="sr-only"
          disabled={isUploading}
        />

        <div className="upload-icon">
          {isUploading ? (
            <div className="loading-spinner" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
              <path d="M14 2v5h5" />
              <path d="M12 17V9" />
              <path d="m9 12 3-3 3 3" />
            </svg>
          )}
        </div>

        {isUploading ? (
          <div className="upload-copy">
            <strong>{status}</strong>
            <span>The assistant is reading structure, context, and citations.</span>
          </div>
        ) : (
          <div className="upload-copy">
            <strong>Drop files here</strong>
            <span>{SUPPORTED_UPLOAD_LABEL} up to {MAX_UPLOAD_LABEL}</span>
            <button type="button" className="btn btn-secondary" tabIndex={-1}>
              Browse Files
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
