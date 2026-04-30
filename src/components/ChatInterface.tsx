'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

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

const thinkingMessages = ['Analyzing document...', 'Extracting context...', 'Checking sources...'];

export default function ChatInterface({ documentId, documentName }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [thinkingIndex, setThinkingIndex] = useState(0);
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
    if (!loading) return;

    const interval = window.setInterval(() => {
      setThinkingIndex((current) => (current + 1) % thinkingMessages.length);
    }, 1200);

    return () => window.clearInterval(interval);
  }, [loading]);

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
    setThinkingIndex(0);

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
            <div className="message-bubble">
              <div className="message-content">{msg.content}</div>

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
            <div className="message-bubble thinking-bubble">
              <div className="loading-dots">
                <span />
                <span />
                <span />
              </div>
              <p>{thinkingMessages[thinkingIndex]}</p>
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
