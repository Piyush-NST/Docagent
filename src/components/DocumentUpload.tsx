'use client';

import React, { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import DocumentAnalysisLoader, { AnalysisStep } from './DocumentAnalysisLoader';
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
  status?: string;
  processing: {
    status?: string;
    totalChunks: number;
    pages?: number;
    textLength: number;
    ocrUsed: boolean;
    embeddingsCreated: number;
    grounded?: boolean;
    indexStatus: string;
    retrievalStatus: string;
    estimatedConfidence: number;
    errorCode?: string;
    userMessage?: string;
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

const uploadAnalysisSteps: AnalysisStep[] = [
  { label: 'Upload received', detail: 'Securing your file inside the assistant workspace.' },
  { label: 'Extracting document text', detail: 'Reading pages, paragraphs, tables, and metadata.' },
  { label: 'Running OCR fallback if needed', detail: 'Checking whether image-aware extraction can recover more text.' },
  { label: 'Chunking document', detail: 'Splitting the content into clean source-aware sections.' },
  { label: 'Creating embeddings', detail: 'Indexing the document so grounded answers can find the right context.' },
];

const UPLOAD_TIMEOUT_MS = 120_000;
const MIN_ANALYSIS_DELAY_MS = 4_400;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getUserFriendlyError(error: string): UploadToast {
  const errorMap: Record<string, string> = {
    'No text in document': 'Could not extract text from this file. Please try a different document.',
    'No text found': 'No readable text found in this image. Please try a clearer image.',
    Unsupported: `This file type is not supported. Please upload ${SUPPORTED_UPLOAD_LABEL} files.`,
    GEMINI_API_KEY: 'Service temporarily unavailable. Please try again later.',
    OPENAI_API_KEY: 'Service temporarily unavailable. Please try again later.',
    quota: 'Service limit reached. Please try again later.',
    'rate limit': 'Too many requests. Please wait a moment and try again.',
    '429': 'Too many requests. Please wait a moment and try again.',
    '500': 'Something went wrong on our end. Please try again.',
    '503': 'Service temporarily unavailable. Please try again later.',
    network: 'Network error. Please check your connection.',
    timeout: 'Request timed out. Please try again.',
    AbortError: 'Upload timed out. Please try again with a smaller file or fewer pages.',
    'timed out': 'Upload timed out. Please try again with a smaller file or fewer pages.',
    'took too long': 'Upload timed out. Please try again with a smaller file or fewer pages.',
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
        details:
          key.toLowerCase().includes('large') || key === 'FILE_TOO_LARGE'
            ? undefined
            : `Supported uploads: ${SUPPORTED_UPLOAD_LABEL}, up to ${MAX_UPLOAD_LABEL}.`,
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [toast, setToast] = useState<UploadToast | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const showToast = (nextToast: UploadToast) => {
    setToast(nextToast);
    setTimeout(() => setToast(null), nextToast.type === 'error' ? 7200 : 4200);
  };

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (isUploading) return;
      setIsDragging(true);
    },
    [isUploading],
  );

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

    setPreviewName(file.name);
    setIsUploading(true);
    setToast(null);
    setAnalysisError(null);
    const analysisStartedAt = Date.now();

    const controller = new AbortController();
    const uploadTimeout = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      const responseType = res.headers.get('content-type') || '';
      const data = responseType.includes('application/json')
        ? await res.json()
        : { message: await res.text() };

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

      const elapsed = Date.now() - analysisStartedAt;
      if (elapsed < MIN_ANALYSIS_DELAY_MS) {
        await wait(MIN_ANALYSIS_DELAY_MS - elapsed);
      }

      const status = data.status || data.processing?.status;
      if (status === 'ocr_failed' || status === 'needs_attention') {
        showToast({
          type: 'error',
          title: status === 'ocr_failed' ? 'OCR failed' : 'Needs attention',
          message:
            data.processing?.userMessage ||
            data.message ||
            'We could not reliably read text from this upload.',
        });
      } else {
        showToast({
          type: 'success',
          title: 'Document ready',
          message: `"${file.name}" is indexed and ready to chat.`,
        });
      }
      onDocumentUploaded(data);
    } catch (err) {
      console.error('Upload error:', err);
      const errorMsg = err instanceof Error ? `${err.name}: ${err.message}` : 'Upload failed';
      setAnalysisError('The document could not be processed. Please review the message and try again.');
      const elapsed = Date.now() - analysisStartedAt;
      if (elapsed < MIN_ANALYSIS_DELAY_MS) {
        await wait(MIN_ANALYSIS_DELAY_MS - elapsed);
      } else {
        await wait(900);
      }
      showToast(getUserFriendlyError(errorMsg));
    } finally {
      window.clearTimeout(uploadTimeout);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setIsUploading(false);
      setPreviewName(null);
    }
  };

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      if (isUploading) return;

      const files = event.dataTransfer.files;
      if (files.length > 0) uploadFile(files[0]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isUploading],
  );

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) uploadFile(files[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.section
      className="upload-card-premium"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
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

      <motion.div
        className={`upload-zone-premium ${isDragging ? 'dragover' : ''} ${isUploading ? 'uploading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!isUploading) fileInputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (!isUploading && (event.key === 'Enter' || event.key === ' ')) {
            fileInputRef.current?.click();
          }
        }}
        whileHover={!isUploading ? { scale: 1.005 } : undefined}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      >
        <input
          ref={fileInputRef}
          type="file"
          id="file-input"
          accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
          onChange={handleFileSelect}
          className="sr-only"
          disabled={isUploading}
        />

        <AnimatePresence mode="wait">
          {isUploading ? (
            <motion.div
              key="loader"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              style={{ width: '100%' }}
            >
              {previewName ? (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{ marginBottom: 12, color: '#a1a1aa', fontSize: '0.85rem', textAlign: 'left' }}
                >
                  Processing <strong style={{ color: '#fafafa' }}>{previewName}</strong>
                </motion.p>
              ) : null}
              <DocumentAnalysisLoader
                steps={uploadAnalysisSteps}
                title="Preparing your document"
                mode="upload"
                error={analysisError}
              />
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <motion.div
                className="upload-icon-premium"
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                  <path d="M14 2v5h5" />
                  <path d="M12 17V9" />
                  <path d="m9 12 3-3 3 3" />
                </svg>
              </motion.div>

              <div className="upload-copy-premium">
                <strong>Drop files here</strong>
                <span>
                  {SUPPORTED_UPLOAD_LABEL} up to {MAX_UPLOAD_LABEL}
                </span>
                <span className="upload-browse">Browse Files</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.section>
  );
}
