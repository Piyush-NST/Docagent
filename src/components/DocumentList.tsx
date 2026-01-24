'use client';

import React, { useState } from 'react';

interface Document {
  documentId: string;
  fileName: string;
  chunkCount: number;
  fileType?: string;
  uploadedAt?: string;
}

interface DocumentListProps {
  documents: Document[];
  selectedDocumentId: string | null;
  onSelectDocument: (doc: Document) => void;
  onDeleteDocument: (documentId: string) => void;
}

function getIcon(fileType?: string) {
  if (fileType?.includes('pdf')) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    );
  }
  if (fileType?.includes('word') || fileType?.includes('docx')) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export default function DocumentList({ documents, selectedDocumentId, onSelectDocument, onDeleteDocument }: DocumentListProps) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    
    if (deleting) return;
    
    setDeleting(docId);
    try {
      await onDeleteDocument(docId);
    } finally {
      setDeleting(null);
    }
  };

  if (documents.length === 0) {
    return (
      <div className="glass-card">
        <h2 style={{ marginBottom: 'var(--spacing-md)' }}>Documents</h2>
        <div className="empty-state" style={{ padding: 'var(--spacing-lg)' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.5, marginBottom: 'var(--spacing-md)' }}>
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No documents yet
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card">
      <h2 style={{ marginBottom: 'var(--spacing-md)' }}>Documents</h2>
      <div className="document-list">
        {documents.map((doc) => (
          <div
            key={doc.documentId}
            className={`document-item ${selectedDocumentId === doc.documentId ? 'active' : ''}`}
            onClick={() => onSelectDocument(doc)}
          >
            <div className="document-icon">
              {getIcon(doc.fileType)}
            </div>
            <div className="document-info">
              <div className="document-name">{doc.fileName}</div>
              <div className="document-meta">
                {doc.chunkCount} chunks
              </div>
            </div>
            {selectedDocumentId === doc.documentId && (
              <div className="status-badge status-success" style={{ marginRight: 'var(--spacing-sm)' }}>
                Active
              </div>
            )}
            <button
              className="delete-btn"
              onClick={(e) => handleDelete(e, doc.documentId)}
              disabled={deleting === doc.documentId}
              title="Delete"
              style={{
                padding: 'var(--spacing-xs)',
                background: 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: deleting === doc.documentId ? 0.5 : 1,
              }}
            >
              {deleting === doc.documentId ? (
                <div className="loading-spinner" style={{ width: '14px', height: '14px' }}></div>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
