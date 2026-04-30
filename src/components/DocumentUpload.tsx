'use client';

import React, { useCallback, useState } from 'react';

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

const loadingMessages = [
  'Uploading document...',
  'Analyzing document...',
  'Extracting context...',
  'Preparing grounded answers...',
];

function getUserFriendlyError(error: string): string {
  const errorMap: Record<string, string> = {
    'No text in document': 'Could not extract text from this file. Please try a different document.',
    'No text found': 'No readable text found in this image. Please try a clearer image.',
    Unsupported: 'This file type is not supported. Please upload PDF, DOCX, or image files.',
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
    'File too large': 'File is too large. Maximum size is 10MB.',
    'extract text': 'Could not read this document. Please try a different file.',
  };

  const lowerError = error.toLowerCase();

  for (const [key, message] of Object.entries(errorMap)) {
    if (lowerError.includes(key.toLowerCase())) {
      return message;
    }
  }

  return 'Something went wrong. Please try again with a different file.';
}

export default function DocumentUpload({ onDocumentUploaded }: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [status, setStatus] = useState(loadingMessages[0]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4200);
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
    if (file.size > 10 * 1024 * 1024) {
      showToast('error', 'File is too large. Maximum size is 10MB.');
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
        throw new Error(data.message || data.error || 'Upload failed');
      }

      setStatus(loadingMessages[3]);
      showToast('success', `"${file.name}" is ready to chat.`);
      onDocumentUploaded(data);
    } catch (err) {
      console.error('Upload error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Upload failed';
      showToast('error', getUserFriendlyError(errorMsg));
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
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m20 6-11 11-5-5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          )}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
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
            <span>PDF, DOCX, PNG, JPG up to 10MB</span>
            <button type="button" className="btn btn-secondary" tabIndex={-1}>
              Browse Files
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
