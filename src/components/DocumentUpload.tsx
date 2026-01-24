'use client';

import React, { useState, useCallback } from 'react';

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

function getUserFriendlyError(error: string): string {
  const errorMap: Record<string, string> = {
    'No text in document': 'Could not extract text from this file. Please try a different document.',
    'No text found': 'No readable text found in this image. Please try a clearer image.',
    'Unsupported': 'This file type is not supported. Please upload PDF, DOCX, or image files.',
    'GROQ_API_KEY': 'Service temporarily unavailable. Please try again later.',
    'GEMINI_API_KEY': 'Service temporarily unavailable. Please try again later.',
    'OPENAI_API_KEY': 'Service temporarily unavailable. Please try again later.',
    'quota': 'Service limit reached. Please try again later.',
    'rate limit': 'Too many requests. Please wait a moment and try again.',
    '429': 'Too many requests. Please wait a moment and try again.',
    '500': 'Something went wrong on our end. Please try again.',
    '503': 'Service temporarily unavailable. Please try again later.',
    'network': 'Network error. Please check your connection.',
    'timeout': 'Request timed out. Please try again.',
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
  const [status, setStatus] = useState('');

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const uploadFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      showToast('error', 'File is too large. Maximum size is 10MB.');
      return;
    }

    setIsUploading(true);
    setToast(null);
    setStatus('Uploading...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      setStatus('Processing document...');
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Upload failed');
      }

      setStatus('');
      showToast('success', `"${file.name}" uploaded successfully!`);
      onDocumentUploaded(data);

    } catch (err) {
      console.error('Upload error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Upload failed';
      showToast('error', getUserFriendlyError(errorMsg));
      setStatus('');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) uploadFile(files[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) uploadFile(files[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="glass-card" style={{ position: 'relative' }}>
      <h2 style={{ marginBottom: 'var(--spacing-md)' }}>Upload Document</h2>
      
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: 'var(--spacing-md) var(--spacing-lg)',
            borderRadius: 'var(--radius-lg)',
            background: toast.type === 'success' 
              ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95))'
              : 'linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(185, 28, 28, 0.95))',
            color: 'white',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-sm)',
            maxWidth: '400px',
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          {toast.type === 'success' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <span style={{ fontSize: '0.9rem' }}>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              marginLeft: 'var(--spacing-sm)',
              opacity: 0.8,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      
      <div
        className={`upload-zone ${isDragging ? 'dragover' : ''} ${isUploading ? 'uploading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <input
          type="file"
          id="file-input"
          accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          disabled={isUploading}
        />
        
        <div className="upload-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>

        {isUploading ? (
          <div>
            <div className="loading-spinner" style={{ margin: '0 auto var(--spacing-md)' }}></div>
            <p style={{ color: 'var(--accent-secondary)' }}>{status}</p>
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              Drop your file here
            </p>
            <p style={{ fontSize: '0.875rem', marginTop: 'var(--spacing-sm)' }}>
              or click to select
            </p>
            <p style={{ fontSize: '0.75rem', marginTop: 'var(--spacing-md)', color: 'var(--text-muted)' }}>
              PDF, DOCX, PNG, JPG (max 10MB)
            </p>
          </>
        )}
      </div>
    </div>
  );
}
