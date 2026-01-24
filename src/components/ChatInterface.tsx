'use client';

import React, { useState, useRef, useEffect } from 'react';

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

export default function ChatInterface({ documentId, documentName }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (documentId && documentName) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `Ready to answer questions about "${documentName}". What would you like to know?`,
        timestamp: new Date(),
      }]);
    } else {
      setMessages([]);
    }
  }, [documentId, documentName]);

  const sendMessage = async () => {
    if (!input.trim() || !documentId || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

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

      setMessages(prev => [...prev, botMsg]);
    } catch (err) {
      console.error('Chat error:', err);
      showToast('Unable to get response. Please try again.');
      
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I encountered an issue processing your question. Please try again.',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!documentId) {
    return (
      <div className="glass-card chat-container">
        <div className="empty-state">
          <svg className="empty-state-icon" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <h3>No Document Selected</h3>
          <p style={{ marginTop: 'var(--spacing-sm)' }}>
            Upload a document first to start chatting
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card chat-container">
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: 'var(--spacing-md) var(--spacing-lg)',
            borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(185, 28, 28, 0.95))',
            color: 'white',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-sm)',
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: '0.9rem' }}>{toast}</span>
        </div>
      )}

      <div style={{ 
        padding: 'var(--spacing-md)', 
        borderBottom: '1px solid var(--border-color)',
        marginBottom: 'var(--spacing-md)'
      }}>
        <h3 style={{ color: 'var(--text-primary)' }}>Chat with Document</h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Chatting about: {documentName}
        </p>
      </div>

      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            <div className="message-content">{msg.content}</div>
            
            {msg.sources && msg.sources.length > 0 && (
              <div className="sources">
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--spacing-sm)' }}>
                  Sources:
                </p>
                <div>
                  {msg.sources.map((source, idx) => (
                    <span key={source.chunkId} className="source-tag">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      {source.page ? `Page ${source.page}` : `Source ${idx + 1}`}
                      {source.section && source.section !== `Chunk ${idx + 1}` && (
                        <span style={{ opacity: 0.7 }}> - {source.section.substring(0, 20)}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        
        {loading && (
          <div className="message message-assistant">
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <input
          type="text"
          placeholder="Ask something about the document..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={loading}
        />
        <button 
          className="btn btn-primary" 
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          {loading ? (
            <div className="loading-spinner" style={{ width: '16px', height: '16px' }}></div>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
