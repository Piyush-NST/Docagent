'use client';

import React, { useEffect, useMemo, useState } from 'react';

export interface AnalysisStep {
  label: string;
  detail?: string;
}

interface DocumentAnalysisLoaderProps {
  steps: AnalysisStep[];
  title?: string;
  mode?: 'upload' | 'chat';
  error?: string | null;
}

export default function DocumentAnalysisLoader({
  steps,
  title = 'Document analysis in progress',
  mode = 'upload',
  error,
}: DocumentAnalysisLoaderProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [typedText, setTypedText] = useState('');

  const activeCopy = useMemo(() => {
    if (error) return error;
    return steps[activeStep]?.detail || steps[activeStep]?.label || 'Preparing analysis...';
  }, [activeStep, error, steps]);

  useEffect(() => {
    if (error || steps.length < 2) return;

    const interval = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % steps.length);
    }, mode === 'chat' ? 1250 : 1450);

    return () => window.clearInterval(interval);
  }, [error, mode, steps.length]);

  useEffect(() => {
    if (!activeCopy) return;

    let index = 0;
    const resetTimeout = window.setTimeout(() => setTypedText(''), 0);
    const interval = window.setInterval(() => {
      index += 1;
      setTypedText(activeCopy.slice(0, index));

      if (index >= activeCopy.length) {
        window.clearInterval(interval);
      }
    }, 24);

    return () => {
      window.clearTimeout(resetTimeout);
      window.clearInterval(interval);
    };
  }, [activeCopy]);

  const progress = error ? 100 : ((activeStep + 1) / steps.length) * 100;

  return (
    <div className={`analysis-loader analysis-loader-${mode} ${error ? 'analysis-loader-error' : ''}`} role="status" aria-live="polite">
      <div className="analysis-loader-bg" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="analysis-loader-orb" aria-hidden="true">
        <div className="analysis-loader-core">
          <span />
        </div>
      </div>

      <div className="analysis-loader-copy">
        <span className="analysis-loader-kicker">{error ? 'Attention needed' : 'Live pipeline'}</span>
        <strong>{error ? 'Analysis paused' : title}</strong>
        <p>
          {typedText}
          {!error && <span className="type-caret" aria-hidden="true" />}
        </p>
      </div>

      <div className="analysis-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="analysis-step-list">
        {steps.map((step, index) => {
          const isDone = !error && index < activeStep;
          const isActive = !error && index === activeStep;

          return (
            <div className={`analysis-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`} key={step.label}>
              <span className="analysis-step-marker">{isDone ? 'OK' : index + 1}</span>
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
