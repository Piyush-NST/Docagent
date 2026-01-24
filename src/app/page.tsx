'use client';

import { useState, useEffect } from 'react';
import DocumentUpload from '@/components/DocumentUpload';
import DocumentList from '@/components/DocumentList';
import ChatInterface from '@/components/ChatInterface';

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

interface Document {
  documentId: string;
  fileName: string;
  chunkCount: number;
  fileType?: string;
}

export default function Home() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (data.documents) {
        setDocuments(data.documents.map((d: { documentId: string; fileName: string; chunkCount: number }) => ({
          documentId: d.documentId,
          fileName: d.fileName,
          chunkCount: d.chunkCount,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch docs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDocumentUploaded = (doc: UploadedDocument) => {
    const newDoc: Document = {
      documentId: doc.documentId,
      fileName: doc.fileName,
      chunkCount: doc.processing.totalChunks,
      fileType: doc.fileType,
    };
    
    setDocuments(prev => [...prev, newDoc]);
    setSelectedDoc(newDoc);
  };

  const handleSelectDocument = (doc: Document) => {
    setSelectedDoc(doc);
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      const res = await fetch(`/api/documents?documentId=${documentId}`, {
        method: 'DELETE',
      });
      
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.documentId !== documentId));
        
        if (selectedDoc?.documentId === documentId) {
          setSelectedDoc(null);
        }
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <div className="container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              <path d="M8 10h8" />
              <path d="M8 14h4" />
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem' }}>DocAgent</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              AI Document Assistant
            </p>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <span className="status-badge status-success">
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }}></span>
            {loading ? 'Loading...' : 'Ready'}
          </span>
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar">
          <DocumentUpload onDocumentUploaded={handleDocumentUploaded} />
          <DocumentList
            documents={documents}
            selectedDocumentId={selectedDoc?.documentId || null}
            onSelectDocument={handleSelectDocument}
            onDeleteDocument={handleDeleteDocument}
          />
        </aside>

        <main className="main-content">
          <ChatInterface
            documentId={selectedDoc?.documentId || null}
            documentName={selectedDoc?.fileName}
          />

          <div className="glass-card" style={{ padding: 'var(--spacing-md)' }}>
            <div style={{ display: 'flex', gap: 'var(--spacing-lg)', flexWrap: 'wrap' }}>
              <div>
                <h4 style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 'var(--spacing-xs)' }}>
                  GROUNDING
                </h4>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                  Answers only from documents
                </p>
              </div>
              <div>
                <h4 style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 'var(--spacing-xs)' }}>
                  SOURCES
                </h4>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                  Shows page references
                </p>
              </div>
              <div>
                <h4 style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 'var(--spacing-xs)' }}>
                  SUPPORTED FILES
                </h4>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                  PDF, DOCX, PNG, JPG
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>

      <footer style={{ 
        textAlign: 'center', 
        padding: 'var(--spacing-lg)', 
        color: 'var(--text-muted)',
        fontSize: '0.75rem',
        marginTop: 'var(--spacing-xl)'
      }}>
        <p>
          Built with Next.js + Azure OpenAI + Azure Blob Storage
        </p>
        <p style={{ marginTop: 'var(--spacing-xs)' }}>
          Document Q&A Prototype
        </p>
      </footer>
    </div>
  );
}
