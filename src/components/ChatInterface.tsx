'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import DocumentAnalysisLoader, { AnalysisStep } from './DocumentAnalysisLoader';

interface Source {
  chunkId: string;
  page?: number;
  section?: string;
  relevance: number;
  preview?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  isGrounded?: boolean;
  timestamp: Date;
}

interface ChatInterfaceProps {
  documentId: string | null;
  documentName?: string;
}

interface AnswerSection {
  title: string;
  items: string[];
  paragraphs: string[];
}

const answerAnalysisSteps: AnalysisStep[] = [
  { label: 'Searching relevant context', detail: 'Matching your question against the indexed document sections.' },
  { label: 'Preparing grounded answer', detail: 'Composing an answer with source-aware evidence.' },
  { label: 'Checking sources', detail: 'Verifying that the response stays tied to retrieved context.' },
];

const MIN_ANSWER_DELAY_MS = 4_200;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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

function cleanAnswerLine(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function splitDenseText(text: string) {
  const cleaned = cleanAnswerLine(text);
  if (cleaned.length <= 190) return [cleaned];

  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
  const chunks: string[] = [];

  for (const sentence of sentences) {
    const trimmed = cleanAnswerLine(sentence);
    if (!trimmed) continue;

    if (trimmed.length <= 220) {
      chunks.push(trimmed);
      continue;
    }

    const parts = trimmed.split(/\s{2,}|;\s+|,\s+(?=[A-Z][a-z])/).map(cleanAnswerLine).filter(Boolean);
    chunks.push(...(parts.length > 1 ? parts : [trimmed.slice(0, 220).trim()]));
  }

  return chunks.length > 0 ? chunks : [cleaned.slice(0, 220).trim()];
}

function formatInlineText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }

    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
}

function getSectionIcon(title: string) {
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('education')) return 'ED';
  if (lowerTitle.includes('experience') || lowerTitle.includes('project')) return 'XP';
  if (lowerTitle.includes('skill')) return 'SK';
  if (lowerTitle.includes('date') || lowerTitle.includes('number')) return 'NO';
  if (lowerTitle.includes('highlight') || lowerTitle.includes('finding')) return 'HI';
  return 'AI';
}

function parseAnswerSections(content: string): AnswerSection[] {
  const cleaned = cleanAnswerText(content);
  const lines = cleaned.split('\n');
  const sections: AnswerSection[] = [];
  let currentSection: AnswerSection | null = null;

  const ensureSection = () => {
    if (!currentSection) {
      currentSection = { title: 'Overview', items: [], paragraphs: [] };
      sections.push(currentSection);
    }

    return currentSection;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      currentSection = { title: heading[1].trim(), items: [], paragraphs: [] };
      sections.push(currentSection);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      ensureSection().items.push(...splitDenseText(bullet[1].trim()));
      continue;
    }

    const target = ensureSection();
    const denseLines = splitDenseText(trimmed);
    if (trimmed.length > 180 || denseLines.length > 1) {
      target.items.push(...denseLines);
    } else {
      target.paragraphs.push(cleanAnswerLine(trimmed));
    }
  }

  return sections.filter(section => section.title.toLowerCase() !== 'sources');
}

function AnswerRenderer({ content }: { content: string }) {
  const sections = useMemo(() => parseAnswerSections(content), [content]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  return (
    <div className="answer-renderer">
      {sections.map((section, sectionIndex) => {
        const sectionKey = `${section.title}-${sectionIndex}`;
        const isExpanded = Boolean(expandedSections[sectionKey]);
        const initialCount = section.items.some(item => item.length > 170) ? 3 : 5;
        const visibleItems = isExpanded ? section.items : section.items.slice(0, initialCount);
        const hiddenCount = Math.max(0, section.items.length - visibleItems.length);
        const isLongSection = section.items.length > 4 || section.items.some(item => item.length > 170);

        return (
          <section className={`answer-section ${isLongSection ? 'answer-section-long' : ''}`} key={sectionKey}>
            <div className="answer-section-heading">
              <span>{getSectionIcon(section.title)}</span>
              <h3>{section.title}</h3>
            </div>

            {section.paragraphs.map((paragraph, index) => (
              <p className="answer-paragraph" key={`${section.title}-p-${index}`}>
                {formatInlineText(paragraph)}
              </p>
            ))}

            {section.items.length > 0 && (
              <>
                <div className="answer-card-grid">
                  {visibleItems.map((item, index) => (
                    <div className="answer-bullet-card" key={`${section.title}-item-${index}`}>
                      <span className="answer-bullet-dot" />
                      <p>{formatInlineText(item)}</p>
                    </div>
                  ))}
                </div>

                {hiddenCount > 0 || isExpanded ? (
                  <button
                    type="button"
                    className="answer-toggle"
                    onClick={() => {
                      setExpandedSections((current) => ({
                        ...current,
                        [sectionKey]: !isExpanded,
                      }));
                    }}
                  >
                    {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
                  </button>
                ) : null}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default function ChatInterface({ documentId, documentName }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const promptChips = useMemo(
    () => ['Summarize this document', 'What are the key findings?', 'List dates and numbers'],
    [],
  );

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (documentId && documentName) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: `Ready to answer questions about "${documentName}". What would you like to know?`,
          timestamp: new Date(),
        },
      ]);
    } else {
      setMessages([]);
    }
  }, [documentId, documentName]);

  const sendMessage = async (question = input) => {
    if (!question.trim() || !documentId || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: question.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setAnalysisError(null);
    const analysisStartedAt = Date.now();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          question: userMsg.content,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Request failed');
      }

      const elapsed = Date.now() - analysisStartedAt;
      if (elapsed < MIN_ANSWER_DELAY_MS) {
        await wait(MIN_ANSWER_DELAY_MS - elapsed);
      }

      const botMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.answer || 'I could not generate a response. Please try again.',
        sources: data.sources,
        isGrounded: data.isGrounded,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      console.error('Chat error:', err);
      setAnalysisError('The assistant could not finish this answer. Please try again.');
      const elapsed = Date.now() - analysisStartedAt;
      if (elapsed < MIN_ANSWER_DELAY_MS) {
        await wait(MIN_ANSWER_DELAY_MS - elapsed);
      } else {
        await wait(900);
      }
      showToast('Unable to get response. Please try again.');

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'I encountered an issue processing your question. Please try again.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  if (!documentId) {
    return (
      <section className="glass-card chat-container">
        <div className="chat-header">
          <div>
            <span className="eyebrow">Answer Panel</span>
            <h2>Chat with Document</h2>
          </div>
          <span className="status-badge status-warning">Waiting for upload</span>
        </div>

        <div className="empty-state chat-empty">
          <div className="empty-illustration assistant-illustration">
            <svg viewBox="0 0 140 140" fill="none">
              <rect x="26" y="32" width="88" height="64" rx="22" fill="currentColor" opacity="0.12" />
              <path d="M49 67h42M49 80h26" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
              <circle cx="48" cy="55" r="6" fill="currentColor" opacity="0.55" />
              <circle cx="92" cy="55" r="6" fill="currentColor" opacity="0.55" />
              <path d="M57 99 43 118v-21" fill="currentColor" opacity="0.12" />
            </svg>
          </div>
          <h3>No document selected</h3>
          <p>Upload or choose a document to start an evidence-backed conversation.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="glass-card chat-container">
      {toast && (
        <div className="toast toast-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          <span>{toast}</span>
        </div>
      )}

      <div className="chat-header">
        <div>
          <span className="eyebrow">Answer Panel</span>
          <h2>Chat with Document</h2>
          <p>{documentName}</p>
        </div>
        <span className="status-badge status-success">
          <span className="status-dot" />
          Grounded
        </span>
      </div>

      <div className="chat-messages">
        {messages.map((msg) => (
          <article key={msg.id} className={`message-row message-${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'assistant' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3 4 7v6c0 5 3.4 7.7 8 8 4.6-.3 8-3 8-8V7z" />
                  <path d="M9 12h6" />
                  <path d="M12 9v6" />
                </svg>
              ) : (
                <span>You</span>
              )}
            </div>
            <div className={`message-bubble ${msg.role === 'assistant' ? 'answer-message-bubble' : ''}`}>
              <div className="message-content">
                {msg.role === 'assistant' ? <AnswerRenderer content={msg.content} /> : msg.content}
              </div>

              {msg.sources && msg.sources.length > 0 && (
                <div className="sources">
                  <p>Sources</p>
                  <div>
                    {msg.sources.map((source, idx) => (
                      <span key={source.chunkId} className="source-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <path d="M14 2v6h6" />
                        </svg>
                        {source.page ? `Page ${source.page}` : `Source ${idx + 1}`}
                        {source.section && source.section !== `Chunk ${idx + 1}` && (
                          <span>{source.section.substring(0, 22)}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </article>
        ))}

        {loading && (
          <article className="message-row message-assistant">
            <div className="message-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3 4 7v6c0 5 3.4 7.7 8 8 4.6-.3 8-3 8-8V7z" />
              </svg>
            </div>
            <div className="message-bubble thinking-bubble premium-thinking-bubble">
              <DocumentAnalysisLoader
                steps={answerAnalysisSteps}
                title="Building a grounded answer"
                mode="chat"
                error={analysisError}
              />
            </div>
          </article>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="prompt-chip-row">
        {promptChips.map((chip) => (
          <button type="button" key={chip} onClick={() => sendMessage(chip)} disabled={loading}>
            {chip}
          </button>
        ))}
      </div>

      <div className="chat-input-container">
        <input
          type="text"
          placeholder="Ask anything grounded in this document..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyPress}
          disabled={loading}
        />
        <button className="btn btn-primary icon-btn" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
          {loading ? (
            <div className="loading-spinner small-spinner" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m22 2-7 20-4-9-9-4z" />
              <path d="M22 2 11 13" />
            </svg>
          )}
        </button>
      </div>
    </section>
  );
}
