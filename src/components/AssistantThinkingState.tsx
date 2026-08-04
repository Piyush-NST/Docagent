'use client';

import { useEffect, useState } from 'react';
import { friendlyDocumentName } from '@/lib/structured-answer';

const STAGES = [
  { at: 0, label: 'Reviewing your document' },
  { at: 2_500, label: 'Finding the most relevant details' },
  { at: 5_000, label: 'Personalizing the response' },
  { at: 8_000, label: 'Preparing a grounded answer' },
  { at: 12_000, label: 'Making sure every detail is grounded' },
] as const;

const LONG_WAIT_START = 18_000;

interface AssistantThinkingStateProps {
  fileName?: string;
  startedAt?: number;
  onCancel?: () => void;
  exiting?: boolean;
}

function statusForElapsed(elapsed: number) {
  const stage = [...STAGES].reverse().find((item) => elapsed >= item.at) ?? STAGES[0];
  return { key: `stage-${stage.at}`, label: stage.label, longWait: elapsed >= LONG_WAIT_START };
}

function displayFileName(fileName: string) {
  const extension = fileName.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? '';
  return `${friendlyDocumentName(fileName)}${extension}`;
}

export default function AssistantThinkingState({ fileName, startedAt, onCancel, exiting = false }: AssistantThinkingStateProps) {
  const [status, setStatus] = useState(() => statusForElapsed(0));

  useEffect(() => {
    const started = startedAt ?? Date.now();
    const update = () => setStatus(statusForElapsed(Math.max(0, Date.now() - started)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return (
    <article className={`da-msg da-msg-assistant da-thinking${exiting ? ' is-exiting' : ''}`} aria-busy={!exiting}>
      <div className="da-assistant-meta">
        <span className="da-assistant-mark" aria-hidden="true">
          D
        </span>
        <span>DocAgent</span>
      </div>

      <div className="da-thinking-body" role="status" aria-live="polite" aria-atomic="true">
        <span className="sr-only">DocAgent is preparing a response.</span>
        <div className="da-thinking-status" aria-hidden="true">
          <span className="da-thinking-wave">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <div className="da-thinking-copy-wrap">
            <span key={status.key} className="da-thinking-copy">
              {status.label}
            </span>
            <p className="da-thinking-context">
              {status.longWait
                ? 'Still working through the document - this may take a moment.'
                : fileName
                  ? <>Reviewing the most relevant parts of <span>{displayFileName(fileName)}</span></>
                  : 'Reviewing the most relevant parts of your selected documents'}
            </p>
          </div>
        </div>
        <div className="da-thinking-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        {onCancel && !exiting ? (
          <button type="button" className="da-thinking-stop" onClick={onCancel} aria-label="Stop generating response">
            <span aria-hidden="true" />
            Stop generating
          </button>
        ) : null}
      </div>
    </article>
  );
}
