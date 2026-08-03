'use client';

import React, { useState } from 'react';

interface Document {
  documentId: string;
  fileName: string;
  chunkCount: number;
  fileType?: string;
  uploadedAt?: string;
  status?: string;
}

interface DocumentListProps {
  documents: Document[];
  selectedDocumentId: string | null;
  onSelectDocument: (doc: Document) => void;
  onDeleteDocument: (documentId: string) => void;
}

function getIcon(fileType?: string) {
  if (fileType?.includes('pdf')) return 'PDF';
  if (fileType?.includes('word') || fileType?.includes('docx')) return 'DOC';
  if (fileType?.includes('image')) return 'IMG';
  return 'DOC';
}

function metaLabel(doc: Document) {
  if (doc.status === 'ocr_failed') return 'OCR failed · not indexed';
  if (doc.status === 'limited') return 'Limited coverage';
  if (doc.status === 'ready_with_warnings') return 'Ready with warnings';
  if (doc.status === 'needs_attention') return 'Needs attention';
  if (doc.status === 'failed') return 'Failed';
  if (doc.status === 'processing') return 'Processing…';
  if (doc.chunkCount <= 0) return 'Not indexed';
  return `${doc.chunkCount} indexed chunk${doc.chunkCount === 1 ? '' : 's'}`;
}

export default function DocumentList({
  documents,
  selectedDocumentId,
  onSelectDocument,
  onDeleteDocument,
}: DocumentListProps) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (event: React.MouseEvent<HTMLButtonElement>, docId: string) => {
    event.stopPropagation();
    if (deleting) return;

    setDeleting(docId);
    try {
      await onDeleteDocument(docId);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="glass-card documents-card">
      <div className="section-heading section-heading-row">
        <div>
          <span className="eyebrow">Library</span>
          <h2>Documents</h2>
        </div>
        <span className="doc-count">{documents.length}</span>
      </div>

      {documents.length === 0 ? (
        <div className="empty-state compact-empty">
          <div className="empty-illustration">
            <svg viewBox="0 0 120 120" fill="none">
              <rect x="31" y="18" width="50" height="68" rx="10" fill="currentColor" opacity="0.12" />
              <path d="M70 18v18h18" stroke="currentColor" strokeWidth="4" opacity="0.5" />
              <rect x="18" y="55" width="56" height="44" rx="12" fill="currentColor" opacity="0.18" />
              <path d="M31 73h30M31 84h19" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
            </svg>
          </div>
          <h3>No documents yet</h3>
          <p>Upload a file to create a grounded chat workspace.</p>
        </div>
      ) : (
        <div className="document-list">
          {documents.map((doc) => {
            const isActive = selectedDocumentId === doc.documentId;
            const failed = doc.status === 'ocr_failed' || doc.status === 'failed';
            const warn =
              doc.status === 'ready_with_warnings' ||
              doc.status === 'needs_attention' ||
              doc.status === 'limited';

            return (
              <div
                key={doc.documentId}
                className={`document-item ${isActive ? 'active' : ''} ${failed ? 'document-item-failed' : ''}`}
                onClick={() => onSelectDocument(doc)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    onSelectDocument(doc);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="document-icon">{getIcon(doc.fileType)}</span>
                <span className="document-info">
                  <span className="document-name">{doc.fileName}</span>
                  <span className={`document-meta ${failed || warn ? 'document-meta-warn' : ''}`}>{metaLabel(doc)}</span>
                </span>
                {isActive && <span className="active-dot" aria-label="Selected document" />}
                <button
                  type="button"
                  className="delete-btn"
                  onClick={(event) => handleDelete(event, doc.documentId)}
                  aria-label={`Delete ${doc.fileName}`}
                >
                  {deleting === doc.documentId ? (
                    <span className="loading-spinner small-spinner" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
