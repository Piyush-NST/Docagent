'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ChatInterface from '@/components/ChatInterface';
import DocumentReadinessPanel, { DocumentReadiness } from '@/components/DocumentReadinessPanel';
import DocumentList from '@/components/DocumentList';
import DocumentUpload from '@/components/DocumentUpload';
import type { DocumentProcessingStatus } from '@/lib/document-status';

interface UploadedDocument {
  documentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  status?: DocumentProcessingStatus | string;
  duplicate?: boolean;
  processing: {
    status?: DocumentProcessingStatus | string;
    totalChunks: number;
    pages?: number;
    textLength: number;
    ocrUsed: boolean;
    embeddingsCreated: number;
    grounded?: boolean;
    indexStatus: string;
    retrievalStatus: string;
    readinessCoverage?: number;
    pageCoveragePercent?: number;
    estimatedConfidence?: number;
    pageStats?: DocumentReadiness['pageStats'];
    warnings?: string[];
    errorCode?: string;
    userMessage?: string;
  };
}

interface Document {
  documentId: string;
  fileName: string;
  chunkCount: number;
  fileType?: string;
  status?: DocumentProcessingStatus | string;
  readiness?: DocumentReadiness;
}

function mapProcessingToReadiness(
  fileSize: number,
  processing: UploadedDocument['processing'],
  status?: string,
): DocumentReadiness {
  const nextStatus = (processing.status || status || 'ready') as DocumentProcessingStatus;
  return {
    status: nextStatus,
    fileSize,
    textLength: processing.textLength,
    pages: processing.pages,
    totalChunks: processing.totalChunks,
    embeddingsCreated: processing.embeddingsCreated,
    ocrUsed: processing.ocrUsed,
    grounded: processing.grounded,
    indexStatus: processing.indexStatus,
    retrievalStatus: processing.retrievalStatus,
    readinessCoverage: processing.readinessCoverage ?? processing.estimatedConfidence ?? 0,
    pageCoveragePercent: processing.pageCoveragePercent,
    estimatedConfidence: processing.readinessCoverage ?? processing.estimatedConfidence ?? 0,
    pageStats: processing.pageStats,
    warnings: processing.warnings,
    errorCode: processing.errorCode,
    userMessage: processing.userMessage,
  };
}

function isQueryable(status?: string) {
  return status === 'ready' || status === 'ready_with_warnings' || status === 'limited';
}

export default function AssistantWorkspace() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();

      if (data.documents) {
        const mapped: Document[] = data.documents.map(
          (doc: {
            documentId: string;
            fileName: string;
            chunkCount: number;
            fileType?: string;
            status?: string;
            readiness?: DocumentReadiness;
          }) => ({
            documentId: doc.documentId,
            fileName: doc.fileName,
            chunkCount: doc.status === 'ocr_failed' || doc.status === 'failed' ? 0 : doc.chunkCount,
            fileType: doc.fileType,
            status: doc.status,
            readiness: doc.readiness
              ? {
                  ...doc.readiness,
                  textLength:
                    doc.status === 'ocr_failed' || doc.status === 'failed' ? 0 : doc.readiness.textLength ?? 0,
                  totalChunks:
                    doc.status === 'ocr_failed' || doc.status === 'failed'
                      ? 0
                      : doc.readiness.totalChunks ?? doc.chunkCount,
                  embeddingsCreated:
                    doc.status === 'ocr_failed' || doc.status === 'failed'
                      ? 0
                      : doc.readiness.embeddingsCreated ?? 0,
                  readinessCoverage: doc.readiness.readinessCoverage ?? doc.readiness.estimatedConfidence ?? 0,
                  pageCoveragePercent: doc.readiness.pageCoveragePercent,
                }
              : undefined,
          }),
        );
        setDocuments(mapped);
      }
    } catch (err) {
      console.error('Failed to fetch docs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDocumentUploaded = (doc: UploadedDocument) => {
    const readiness = mapProcessingToReadiness(doc.fileSize, doc.processing, doc.status);
    const newDoc: Document = {
      documentId: doc.documentId,
      fileName: doc.fileName,
      chunkCount: doc.processing.totalChunks,
      fileType: doc.fileType,
      status: readiness.status,
      readiness,
    };

    setDocuments((prev) => {
      const without = prev.filter((item) => item.documentId !== newDoc.documentId);
      return [...without, newDoc];
    });
    setSelectedDoc(newDoc);
    if (isQueryable(newDoc.status)) {
      setSelectedIds([newDoc.documentId]);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      const res = await fetch(`/api/documents?documentId=${documentId}`, { method: 'DELETE' });
      if (res.ok) {
        setDocuments((prev) => prev.filter((doc) => doc.documentId !== documentId));
        setSelectedIds((prev) => prev.filter((id) => id !== documentId));
        if (selectedDoc?.documentId === documentId) setSelectedDoc(null);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleSelectDocument = (doc: Document) => {
    setSelectedDoc(doc);
    if (isQueryable(doc.status)) {
      setSelectedIds((prev) => (prev.includes(doc.documentId) ? prev : [doc.documentId]));
    }
  };

  const toggleCompareDoc = (documentId: string) => {
    setSelectedIds((prev) =>
      prev.includes(documentId) ? prev.filter((id) => id !== documentId) : [...prev, documentId],
    );
  };

  const documentReady = isQueryable(selectedDoc?.status || selectedDoc?.readiness?.status);
  const readyDocs = documents.filter((doc) => isQueryable(doc.status));

  return (
    <>
      <section className="workspace-page-header animate-rise">
        <div>
          <span className="eyebrow">Assistant Workspace</span>
          <h1>Document intelligence</h1>
          <p>Upload files, validate readiness, and ask grounded questions with source-aware answers.</p>
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
            onSelectDocument={handleSelectDocument}
            onDeleteDocument={handleDeleteDocument}
          />

          {readyDocs.length > 1 ? (
            <section className="glass-card compare-select-card">
              <div className="section-heading">
                <span className="eyebrow">Multi-document</span>
                <h2>Compare set</h2>
                <p>Select two or more ready docs for Compare mode.</p>
              </div>
              <div className="compare-select-list">
                {readyDocs.map((doc) => (
                  <label key={doc.documentId} className="compare-select-item">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(doc.documentId)}
                      onChange={() => toggleCompareDoc(doc.documentId)}
                    />
                    <span>{doc.fileName}</span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}
        </aside>

        <div className="right-rail">
          {selectedDoc?.readiness ? (
            <DocumentReadinessPanel fileName={selectedDoc.fileName} readiness={selectedDoc.readiness} />
          ) : null}
          <ChatInterface
            documentId={selectedDoc?.documentId || null}
            documentIds={selectedIds.length ? selectedIds : selectedDoc?.documentId ? [selectedDoc.documentId] : []}
            documentName={selectedDoc?.fileName}
            documentReady={Boolean(documentReady)}
            documentStatus={selectedDoc?.status || selectedDoc?.readiness?.status}
            documents={documents.map((doc) => ({
              documentId: doc.documentId,
              fileName: doc.fileName,
              status: typeof doc.status === 'string' ? doc.status : undefined,
              pages: doc.readiness?.pages ?? doc.readiness?.pageStats?.totalPages,
              processedPages: doc.readiness?.pageStats?.processedPages,
              pageCoveragePercent: doc.readiness?.pageCoveragePercent,
            }))}
          />
        </div>
      </section>
    </>
  );
}
