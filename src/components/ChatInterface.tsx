'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Source {
  chunkId: string;
  page?: number;
  section?: string;
  relevance: number;
  preview?: string;
  fileName?: string;
  documentId?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  isGrounded?: boolean;
  failureKind?: string;
  timestamp: Date;
  systemHint?: boolean;
}

export interface ChatDocumentContext {
  documentId: string;
  fileName: string;
  status?: string;
  pages?: number;
  processedPages?: number;
  pageCoveragePercent?: number;
}

interface ChatInterfaceProps {
  documentId: string | null;
  documentIds?: string[];
  documentName?: string;
  documentReady?: boolean;
  documentStatus?: string;
  documents?: ChatDocumentContext[];
}

type ChatMode = 'ask' | 'summarize' | 'compare' | 'extract';

const MODE_OPTIONS: Array<{ value: ChatMode; label: string; description: string }> = [
  { value: 'ask', label: 'Ask', description: 'Answer questions using document evidence' },
  { value: 'summarize', label: 'Summarize', description: 'Create a grounded document summary' },
  { value: 'compare', label: 'Compare', description: 'Compare selected documents' },
  { value: 'extract', label: 'Extract', description: 'Return requested structured information' },
];

function cleanAnswerText(content: string) {
  return content
    .replace(/\[Source\s+\d+(?:,\s*Page\s*\d+|- Page\s*\d+)?\]/gi, '')
    .replace(/\bfrom\s+0\s+1\b/gi, '')
    .replace(/\b0\s+1\b/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-b-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={`${keyPrefix}-c-${index}`} className="da-inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t-${index}`}>{part}</React.Fragment>;
  });
}

function parseMarkdownTable(block: string): { headers: string[]; rows: string[][] } | null {
  const lines = block
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2 || !lines[0].includes('|')) return null;
  const splitRow = (line: string) =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const headers = splitRow(lines[0]);
  const sep = lines[1];
  if (!/^\|?[\s:-]+\|/.test(sep) && !/^[\s|:-]+$/.test(sep.replace(/\|/g, ''))) return null;
  const rows = lines.slice(2).map(splitRow).filter((r) => r.some(Boolean));
  if (!headers.length) return null;
  return { headers, rows };
}

function AnswerContent({ content, sources, onCite }: { content: string; sources?: Source[]; onCite?: (s: Source) => void }) {
  const cleaned = useMemo(() => cleanAnswerText(content), [content]);

  const blocks = useMemo(() => {
    const lines = cleaned.split('\n');
    const out: Array<
      | { type: 'heading'; level: number; text: string }
      | { type: 'paragraph'; text: string }
      | { type: 'list'; ordered: boolean; items: string[] }
      | { type: 'table'; headers: string[]; rows: string[][] }
      | { type: 'kv'; pairs: Array<{ key: string; value: string }> }
    > = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        i += 1;
        continue;
      }

      if (trimmed.startsWith('|') && i + 1 < lines.length && lines[i + 1].includes('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].includes('|')) {
          tableLines.push(lines[i]);
          i += 1;
        }
        const table = parseMarkdownTable(tableLines.join('\n'));
        if (table) {
          out.push({ type: 'table', ...table });
          continue;
        }
      }

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        out.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
        i += 1;
        continue;
      }

      const bullet = trimmed.match(/^[-*]\s+(.+)$/);
      const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (bullet || numbered) {
        const ordered = Boolean(numbered);
        const items: string[] = [];
        while (i < lines.length) {
          const t = lines[i].trim();
          const b = t.match(/^[-*]\s+(.+)$/);
          const n = t.match(/^\d+[.)]\s+(.+)$/);
          if (ordered ? n : b) {
            items.push((ordered ? n![1] : b![1]).trim());
            i += 1;
          } else if (!t) {
            i += 1;
            break;
          } else break;
        }
        out.push({ type: 'list', ordered, items });
        continue;
      }

      // Extract-style key: value lines
      const kvMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9 /_-]{1,40})\s*[:=]\s+(.+)$/);
      if (kvMatch) {
        const pairs: Array<{ key: string; value: string }> = [];
        while (i < lines.length) {
          const t = lines[i].trim();
          const m = t.match(/^([A-Za-z][A-Za-z0-9 /_-]{1,40})\s*[:=]\s+(.+)$/);
          if (m) {
            pairs.push({ key: m[1].trim(), value: m[2].trim() });
            i += 1;
          } else if (!t) {
            i += 1;
            break;
          } else break;
        }
        if (pairs.length >= 2) {
          out.push({ type: 'kv', pairs });
          continue;
        }
        // fall through as paragraph if only one
        out.push({ type: 'paragraph', text: `${pairs[0].key}: ${pairs[0].value}` });
        continue;
      }

      out.push({ type: 'paragraph', text: trimmed });
      i += 1;
    }

    return out;
  }, [cleaned]);

  return (
    <div className="da-answer">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          const Tag = (block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4') as 'h2' | 'h3' | 'h4';
          return (
            <Tag key={`h-${idx}`} className="da-answer-heading">
              {formatInline(block.text, `h-${idx}`)}
            </Tag>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={`l-${idx}`} className="da-answer-list">
              {block.items.map((item, itemIdx) => (
                <li key={`li-${idx}-${itemIdx}`}>{formatInline(item, `li-${idx}-${itemIdx}`)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === 'table') {
          return (
            <div key={`t-${idx}`} className="da-table-wrap">
              <table className="da-table">
                <thead>
                  <tr>
                    {block.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rIdx) => (
                    <tr key={`r-${rIdx}`}>
                      {block.headers.map((_, cIdx) => (
                        <td key={`c-${rIdx}-${cIdx}`}>{formatInline(row[cIdx] || '—', `td-${rIdx}-${cIdx}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === 'kv') {
          return (
            <dl key={`kv-${idx}`} className="da-kv-grid">
              {block.pairs.map((pair) => (
                <div key={pair.key} className="da-kv-row">
                  <dt>{pair.key}</dt>
                  <dd>{formatInline(pair.value, `kv-${pair.key}`)}</dd>
                </div>
              ))}
            </dl>
          );
        }
        return (
          <p key={`p-${idx}`} className="da-answer-p">
            {formatInline(block.text, `p-${idx}`)}
            {sources && sources[0] && idx === 0 ? (
              <button
                type="button"
                className="da-cite-inline"
                onClick={() => onCite?.(sources[0])}
                aria-label="Open first source evidence"
              >
                [1]
              </button>
            ) : null}
          </p>
        );
      })}
    </div>
  );
}

function sourceLabel(source: Source, index: number) {
  const name = source.fileName || `Source ${index + 1}`;
  const short = name.length > 36 ? `${name.slice(0, 33)}…` : name;
  return source.page ? `${short} · p.${source.page}` : short;
}

export default function ChatInterface({
  documentId,
  documentIds = [],
  documentName,
  documentReady = true,
  documentStatus,
  documents = [],
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ChatMode>('ask');
  const [modeOpen, setModeOpen] = useState(false);
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [genStep, setGenStep] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  const ids = useMemo(
    () => (documentIds.length > 0 ? documentIds : documentId ? [documentId] : []),
    [documentId, documentIds],
  );
  const selectionKey = ids.join('|');

  const selectedDocs = useMemo(() => {
    if (documents.length) {
      const map = new Map(documents.map((d) => [d.documentId, d]));
      return ids.map((id) => map.get(id)).filter(Boolean) as ChatDocumentContext[];
    }
    if (documentId && documentName) {
      return [{ documentId, fileName: documentName, status: documentStatus }];
    }
    return [];
  }, [documents, documentId, documentName, documentStatus, ids]);

  const chatEnabled = ids.length > 0 && documentReady && (mode !== 'compare' || ids.length >= 2);
  const isLimited = documentStatus === 'limited' || selectedDocs.some((d) => d.status === 'limited');
  const isWarning = documentStatus === 'ready_with_warnings' || selectedDocs.some((d) => d.status === 'ready_with_warnings');
  const conversationStarted = messages.some((m) => m.role === 'user');

  const suggestions = useMemo(() => {
    if (mode === 'summarize') return ['Summarize this document', 'What are the key findings?', 'List important dates'];
    if (mode === 'compare') return ['Compare the uploaded reports', 'What changed between these documents?', 'Compare revenue and profit'];
    if (mode === 'extract') return ['Extract dates and amounts', 'Extract names and organizations', 'Extract key obligations'];
    return ['Summarize this document', 'What are the key findings?', 'Find the key risks', 'List important dates'];
  }, [mode]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!modeMenuRef.current?.contains(event.target as Node)) setModeOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (!loading) {
      setGenStep(0);
      return;
    }
    const timers = [
      window.setTimeout(() => setGenStep(1), 700),
      window.setTimeout(() => setGenStep(2), 1600),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [loading]);

  const scrollToLatest = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) scrollToLatest(true);
  }, [messages, loading, scrollToLatest]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickToBottomRef.current = nearBottom;
    setShowJump(!nearBottom && conversationStarted);
  };

  useEffect(() => {
    // Reset thread when selection changes; empty thread shows empty state (no fake welcome bubble)
    setMessages([]);
    setActiveSource(null);
    setInput('');
  }, [documentId, selectionKey, documentReady]);

  const copyAnswer = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(cleanAnswerText(message.content));
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // ignore
    }
  };

  const sendMessage = async (question = input) => {
    if (!question.trim() || ids.length === 0 || loading || !chatEnabled) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: question.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev.filter((m) => !m.systemHint), userMsg]);
    setInput('');
    setLoading(true);
    setActiveSource(null);
    stickToBottomRef.current = true;
    window.requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: ids[0],
          documentIds: ids,
          question: userMsg.content,
          mode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message =
          data.error === 'DOCUMENT_NOT_READY'
            ? data.message || 'Selected documents are not ready for questions yet.'
            : data.message || 'DocAgent couldn’t generate a response right now. Your documents are still available.';
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            content: message,
            isGrounded: false,
            failureKind: data.failureKind || 'generation_error',
            timestamp: new Date(),
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content:
            data.answer ||
            "I couldn't find enough evidence in the selected documents to answer this confidently.",
          sources: data.sources,
          isGrounded: data.isGrounded,
          failureKind: data.failureKind,
          timestamp: new Date(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: 'DocAgent couldn’t generate a response right now. Your documents are still available.',
          isGrounded: false,
          failureKind: 'generation_error',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const statusLabel = !documentId
    ? 'No document'
    : !documentReady
      ? documentStatus === 'ocr_failed'
        ? 'OCR failed'
        : 'Not ready'
      : isLimited
        ? 'Limited coverage'
        : isWarning
          ? 'Ready with warnings'
          : 'Ready';

  const coverageNote = useMemo(() => {
    const limited = selectedDocs.find((d) => d.status === 'limited') || (isLimited ? selectedDocs[0] : null);
    if (!limited) return null;
    if (limited.processedPages != null && limited.pages != null) {
      return `${limited.processedPages} of ${limited.pages} pages processed. Answers may only reflect processed content.`;
    }
    if (limited.pageCoveragePercent != null) {
      return `${limited.pageCoveragePercent}% processing coverage. Answers may only reflect processed content.`;
    }
    return 'Partial document coverage. Answers may only reflect processed content.';
  }, [isLimited, selectedDocs]);

  const genLabels = ['Searching your documents…', 'Reading relevant passages…', 'Writing a grounded answer…'];

  if (!documentId) {
    return (
      <section className="da-chat glass-card">
        <header className="da-chat-top">
          <div className="da-chat-top-copy">
            <p className="da-chat-kicker">Conversation</p>
            <h2>Ask your documents</h2>
            <p className="da-chat-sub">Grounded answers with page-level sources</p>
          </div>
          <span className="da-chat-status">Waiting for document</span>
        </header>

        <div className="da-chat-body">
          <div className="da-chat-scroll">
            <div className="da-chat-thread">
              <div className="da-chat-hero">
                <h3>Upload or select a document</h3>
                <p>
                  Once a file is ready, you can ask questions here and DocAgent will answer from the retrieved evidence —
                  with citations you can open.
                </p>
              </div>
            </div>
          </div>
        </div>

        <footer className="da-composer-wrap">
          <div className="da-composer da-composer-disabled">
            <textarea
              rows={1}
              disabled
              placeholder="Select a document to start asking…"
              aria-label="Message"
            />
            <div className="da-composer-bar">
              <button type="button" className="da-mode-trigger" disabled>
                Ask <span aria-hidden="true">▾</span>
              </button>
              <button type="button" className="da-send" disabled aria-label="Send message">
                Send
              </button>
            </div>
          </div>
          <p className="da-composer-hint">Upload a PDF, DOCX, or image on the left to begin</p>
        </footer>
      </section>
    );
  }

  return (
    <section className={`da-chat glass-card ${activeSource ? 'da-chat-with-evidence' : ''}`}>
      <header className="da-chat-top">
        <div className="da-chat-top-copy">
          <p className="da-chat-kicker">Conversation</p>
          <h2>{documentName || 'Document chat'}</h2>
          <p className="da-chat-sub">
            {ids.length > 1 ? `${ids.length} documents in scope` : 'Grounded answers with page-level sources'}
          </p>
        </div>
        <span className={`da-chat-status da-chat-status-${documentReady ? (isLimited || isWarning ? 'warn' : 'ok') : 'bad'}`}>
          {statusLabel}
        </span>
      </header>

      {(isLimited || isWarning) && documentReady ? (
        <div className={`da-chat-banner ${isLimited ? 'is-limited' : 'is-warn'}`} role="status">
          <strong>{isLimited ? 'Partial document coverage' : 'Ready with warnings'}</strong>
          <span>{coverageNote}</span>
        </div>
      ) : null}

      {!documentReady ? (
        <div className="da-chat-banner is-bad" role="status">
          <strong>Document not ready</strong>
          <span>Usable text could not be extracted yet. Upload a clearer file or a searchable PDF/DOCX.</span>
        </div>
      ) : null}

      <div className="da-chat-body">
        <div className="da-chat-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="da-chat-thread">
            {!conversationStarted && !loading ? (
              <div className="da-chat-hero">
                <h3>Ask your documents</h3>
                <p>
                  Get answers grounded in the files you’ve selected, with citations that point back to the retrieved
                  evidence.
                </p>
                {chatEnabled ? (
                  <div className="da-suggest-row">
                    {suggestions.map((chip) => (
                      <button type="button" key={chip} className="da-suggest" onClick={() => sendMessage(chip)}>
                        {chip}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <article key={msg.id} className="da-msg da-msg-user">
                    <div className="da-user-bubble">{msg.content}</div>
                  </article>
                );
              }

              const noEvidence = msg.failureKind === 'no_evidence' || msg.isGrounded === false;
              return (
                <article key={msg.id} className="da-msg da-msg-assistant">
                  <div className="da-assistant-meta">
                    <span className="da-assistant-mark" aria-hidden="true">
                      D
                    </span>
                    <span>DocAgent</span>
                    {msg.isGrounded ? <span className="da-pill da-pill-ok">Grounded</span> : null}
                    {noEvidence && !msg.failureKind?.includes('error') ? (
                      <span className="da-pill da-pill-muted">No evidence</span>
                    ) : null}
                  </div>

                  <AnswerContent content={msg.content} sources={msg.sources} onCite={setActiveSource} />

                  {msg.sources && msg.sources.length > 0 ? (
                    <div className="da-sources">
                      <span className="da-sources-label">Sources</span>
                      <div className="da-source-list">
                        {msg.sources.map((source, idx) => (
                          <button
                            type="button"
                            key={source.chunkId || `${msg.id}-${idx}`}
                            className={`da-source-chip ${activeSource?.chunkId === source.chunkId ? 'is-active' : ''}`}
                            onClick={() => setActiveSource(source)}
                          >
                            <span className="da-source-index">[{idx + 1}]</span>
                            <span>{sourceLabel(source, idx)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="da-msg-actions">
                    <button type="button" onClick={() => copyAnswer(msg)} aria-label="Copy answer">
                      {copiedId === msg.id ? 'Copied' : 'Copy'}
                    </button>
                    {msg.sources && msg.sources.length > 0 ? (
                      <button type="button" onClick={() => setActiveSource(msg.sources![0])} aria-label="Show sources">
                        Show evidence
                      </button>
                    ) : null}
                    {msg.failureKind === 'generation_error' || msg.failureKind === 'no_evidence' ? (
                      <button
                        type="button"
                        onClick={() => {
                          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                          if (lastUser) sendMessage(lastUser.content);
                        }}
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}

            {loading ? (
              <article className="da-msg da-msg-assistant" aria-live="polite" aria-busy="true">
                <div className="da-assistant-meta">
                  <span className="da-assistant-mark" aria-hidden="true">
                    D
                  </span>
                  <span>DocAgent</span>
                </div>
                <div className="da-generating">
                  <span className="da-gen-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>{genLabels[genStep] || genLabels[0]}</span>
                </div>
              </article>
            ) : null}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {activeSource ? (
          <aside className="da-evidence" aria-label="Evidence panel">
            <div className="da-evidence-head">
              <div>
                <p className="da-chat-kicker">Evidence</p>
                <strong>{activeSource.fileName || 'Document'}</strong>
                <p>
                  {activeSource.page ? `Page ${activeSource.page}` : 'Page unavailable'}
                  {activeSource.section ? ` · ${activeSource.section}` : ''}
                </p>
              </div>
              <button type="button" className="da-icon-btn" onClick={() => setActiveSource(null)} aria-label="Close evidence">
                ✕
              </button>
            </div>
            <div className="da-evidence-body">
              <p className="da-evidence-snippet">{activeSource.preview || 'No snippet available for this citation.'}</p>
            </div>
          </aside>
        ) : null}
      </div>

      {showJump ? (
        <button type="button" className="da-jump" onClick={() => scrollToLatest(true)}>
          Jump to latest
        </button>
      ) : null}

      <footer className="da-composer-wrap">
        <div className="da-composer">
          {selectedDocs.length > 0 ? (
            <div className="da-composer-docs" aria-label="Documents in scope">
              {selectedDocs.slice(0, 3).map((doc) => (
                <span key={doc.documentId} className="da-doc-chip" title={doc.fileName}>
                  <span className="da-doc-chip-name">{doc.fileName}</span>
                  <span className="da-doc-chip-meta">
                    {doc.status === 'limited' ? 'Limited' : doc.status === 'ready_with_warnings' ? 'Warnings' : 'Ready'}
                  </span>
                </span>
              ))}
              {selectedDocs.length > 3 ? <span className="da-doc-more">+{selectedDocs.length - 3}</span> : null}
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading || !chatEnabled}
            placeholder={
              !chatEnabled
                ? mode === 'compare' && ids.length < 2
                  ? 'Select at least two ready documents for Compare…'
                  : 'Document not ready for questions yet…'
                : 'Ask anything about your documents…'
            }
            aria-label="Message"
          />

          <div className="da-composer-bar">
            <div className="da-composer-left" ref={modeMenuRef}>
              <button
                type="button"
                className="da-mode-trigger"
                aria-haspopup="listbox"
                aria-expanded={modeOpen}
                onClick={() => setModeOpen((open) => !open)}
              >
                {MODE_OPTIONS.find((m) => m.value === mode)?.label || 'Ask'}
                <span aria-hidden="true">▾</span>
              </button>
              {modeOpen ? (
                <div className="da-mode-menu" role="listbox" aria-label="Answer mode">
                  {MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={mode === option.value}
                      disabled={option.value === 'compare' && ids.length < 2}
                      className={mode === option.value ? 'is-active' : ''}
                      onClick={() => {
                        setMode(option.value);
                        setModeOpen(false);
                      }}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="da-send"
              onClick={() => sendMessage()}
              disabled={loading || !chatEnabled || !input.trim()}
              aria-label="Send message"
            >
              {loading ? <span className="da-send-spinner" /> : 'Send'}
            </button>
          </div>
        </div>
        <p className="da-composer-hint">Enter to send · Shift+Enter for a new line</p>
      </footer>
    </section>
  );
}
