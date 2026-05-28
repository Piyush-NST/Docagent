'use client';

import Link from 'next/link';
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

export default function AssistantWorkspace() {
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
    <>
      <section className="workspace-page-header animate-rise">
        <div>
          <span className="eyebrow">Assistant Workspace</span>
          <h1>Document command center</h1>
          <p>Upload files, manage indexed documents, and ask grounded questions with source-aware answers.</p>
        </div>
        <div className="workspace-header-actions">
          <Link className="btn btn-secondary" href="/">
            Home
          </Link>
          <span className={`status-badge ${loading ? 'status-warning' : 'status-success'}`}>
            <span className="status-dot" />
            {loading ? 'Syncing workspace' : 'Ready for documents'}
          </span>
        </div>
      </section>

      <section className="workspace-grid animate-rise animate-delay-1" id="workspace">
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
        </div>
      </section>
    </>
  );
}
