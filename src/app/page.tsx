'use client';

import { useEffect, useState } from 'react';
import ChatInterface from '@/components/ChatInterface';
import DocumentList from '@/components/DocumentList';
import DocumentUpload from '@/components/DocumentUpload';

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

const trustSignals = [
  { label: 'Grounded answers', value: 'Source-aware' },
  { label: 'Formats', value: 'PDF, DOCX, images' },
  { label: 'Pipeline', value: 'Groq + Gemini OCR' },
];

const featureCards = [
  {
    title: 'Upload',
    body: 'Drop files into a secure document workspace.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="m17 8-5-5-5 5" />
        <path d="M12 3v12" />
      </svg>
    ),
  },
  {
    title: 'Ask',
    body: 'Query long documents in plain language.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      </svg>
    ),
  },
  {
    title: 'Cite',
    body: 'Review answer evidence with source references.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    ),
  },
];

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
        setDocuments(
          data.documents.map((doc: { documentId: string; fileName: string; chunkCount: number; fileType?: string }) => ({
            documentId: doc.documentId,
            fileName: doc.fileName,
            chunkCount: doc.chunkCount,
            fileType: doc.fileType,
          })),
        );
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

    setDocuments((prev) => [...prev, newDoc]);
    setSelectedDoc(newDoc);
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      const res = await fetch(`/api/documents?documentId=${documentId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setDocuments((prev) => prev.filter((doc) => doc.documentId !== documentId));

        if (selectedDoc?.documentId === documentId) {
          setSelectedDoc(null);
        }
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <main className="app-root">
      <div className="app-shell">
        <div className="ambient-grid" />
        <div className="glow-orb glow-orb-one" />
        <div className="glow-orb glow-orb-two" />
        <div className="glow-orb glow-orb-three" />

        <section className="hero-section animate-rise">
          <div className="hero-copy">
            <div className="brand-pill">
              <span className="spark-icon">*</span>
              Powered by Groq LLM and Gemini OCR
            </div>
            <h1>AI Document Assistant</h1>
            <p>Upload documents. Ask questions. Get grounded answers instantly.</p>
            <div className="hero-actions">
              <a className="btn btn-primary btn-lg" href="#workspace">
                Try Now
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </a>
              <span className={`status-badge ${loading ? 'status-warning' : 'status-success'}`}>
                <span className="status-dot" />
                {loading ? 'Syncing workspace' : 'Ready for documents'}
              </span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="visual-stage">
              <div className="halo-ring" />
              <div className="floating-card doc-card doc-card-pdf">
                <span>PDF</span>
                <div />
                <div />
                <div />
              </div>
              <div className="floating-card doc-card doc-card-docx">
                <span>DOCX</span>
                <div />
                <div />
                <div />
              </div>
              <div className="floating-card answer-card">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3 4 7v6c0 5 3.4 7.7 8 8 4.6-.3 8-3 8-8V7z" />
                  <path d="m9 12 2 2 4-5" />
                </svg>
                <div>
                  <strong>Grounded</strong>
                  <span>Answer with sources</span>
                </div>
              </div>
              <div className="chat-bubble-25d">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </section>

        <section className="trust-strip animate-rise animate-delay-1">
          {trustSignals.map((signal) => (
            <div key={signal.label}>
              <span>{signal.label}</span>
              <strong>{signal.value}</strong>
            </div>
          ))}
        </section>

        <section className="workspace-grid animate-rise animate-delay-2" id="workspace">
          <aside className="left-rail">
            <DocumentUpload onDocumentUploaded={handleDocumentUploaded} />
            <DocumentList
              documents={documents}
              selectedDocumentId={selectedDoc?.documentId || null}
              onSelectDocument={setSelectedDoc}
              onDeleteDocument={handleDeleteDocument}
            />
          </aside>

          <div className="right-rail">
            <ChatInterface documentId={selectedDoc?.documentId || null} documentName={selectedDoc?.fileName} />

            <div className="feature-grid">
              {featureCards.map((feature) => (
                <article className="mini-feature-card" key={feature.title}>
                  <div className="mini-feature-icon">{feature.icon}</div>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
