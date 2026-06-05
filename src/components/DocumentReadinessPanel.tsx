'use client';

interface DocumentReadiness {
  fileSize: number;
  textLength: number;
  pages?: number;
  totalChunks: number;
  embeddingsCreated: number;
  ocrUsed: boolean;
  indexStatus: 'Ready' | 'Failed';
  retrievalStatus: 'Passed' | 'Weak' | 'Failed';
  estimatedConfidence: number;
}

interface DocumentReadinessPanelProps {
  fileName: string;
  readiness: DocumentReadiness;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'ready' || normalized === 'passed') return 'readiness-good';
  if (normalized === 'weak') return 'readiness-warn';
  return 'readiness-bad';
}

export type { DocumentReadiness };

export default function DocumentReadinessPanel({ fileName, readiness }: DocumentReadinessPanelProps) {
  const metrics = [
    { label: 'File size', value: formatBytes(readiness.fileSize), helper: 'Upload payload' },
    { label: 'Extracted text', value: formatNumber(readiness.textLength), helper: 'Characters read' },
    { label: 'Pages detected', value: readiness.pages ? formatNumber(readiness.pages) : 'N/A', helper: 'PDF/page signal' },
    { label: 'Chunks created', value: formatNumber(readiness.totalChunks), helper: 'Retrieval units' },
    { label: 'Embeddings', value: formatNumber(readiness.embeddingsCreated), helper: 'Vector records' },
    { label: 'OCR used', value: readiness.ocrUsed ? 'Yes' : 'No', helper: 'Vision fallback' },
  ];

  return (
    <section className="glass-card readiness-panel">
      <div className="readiness-glow" aria-hidden="true" />
      <div className="readiness-header">
        <div>
          <span className="eyebrow">Document Readiness</span>
          <h2>Index evaluation</h2>
          <p>{fileName}</p>
        </div>
        <span className={`readiness-badge ${statusClass(readiness.indexStatus)}`}>
          <span />
          {readiness.indexStatus}
        </span>
      </div>

      <div className="readiness-score-card">
        <div>
          <span>Estimated answer confidence</span>
          <strong>{readiness.estimatedConfidence}%</strong>
        </div>
        <div className="readiness-progress" aria-hidden="true">
          <span style={{ width: `${readiness.estimatedConfidence}%` }} />
        </div>
      </div>

      <div className="readiness-status-row">
        <div>
          <span>Retrieval test</span>
          <strong className={statusClass(readiness.retrievalStatus)}>{readiness.retrievalStatus}</strong>
        </div>
        <div>
          <span>Index status</span>
          <strong className={statusClass(readiness.indexStatus)}>{readiness.indexStatus}</strong>
        </div>
      </div>

      <div className="readiness-metric-grid">
        {metrics.map((metric) => (
          <div className="readiness-metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.helper}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
