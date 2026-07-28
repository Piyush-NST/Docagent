'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';

const BOOT_STEPS = [
  { id: 'gemini', label: 'Initializing Gemini AI' },
  { id: 'ocr', label: 'Loading OCR Engine' },
  { id: 'vector', label: 'Connecting Vector Database' },
  { id: 'pipeline', label: 'Preparing Document Pipeline' },
] as const;

interface StartupScreenProps {
  onComplete: () => void;
}

export default function StartupScreen({ onComplete }: StartupScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<'boot' | 'ready' | 'exit'>('boot');

  const particles = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        left: `${(i * 37) % 100}%`,
        top: `${(i * 53) % 100}%`,
        delay: (i % 7) * 0.35,
        duration: 4.5 + (i % 5),
        size: 1.5 + (i % 3),
      })),
    [],
  );

  useEffect(() => {
    if (phase !== 'boot') return;

    if (stepIndex < BOOT_STEPS.length) {
      const timer = window.setTimeout(() => setStepIndex((prev) => prev + 1), 900);
      return () => window.clearTimeout(timer);
    }

    const readyTimer = window.setTimeout(() => setPhase('ready'), 350);
    return () => window.clearTimeout(readyTimer);
  }, [phase, stepIndex]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const exitTimer = window.setTimeout(() => setPhase('exit'), 1100);
    return () => window.clearTimeout(exitTimer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'exit') return;
    const doneTimer = window.setTimeout(onComplete, 520);
    return () => window.clearTimeout(doneTimer);
  }, [phase, onComplete]);

  return (
    <AnimatePresence>
      {phase !== 'exit' ? null : null}
      <motion.div
        key="startup"
        className="startup-screen"
        initial={{ opacity: 1 }}
        animate={{ opacity: phase === 'exit' ? 0 : 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="startup-grid" aria-hidden />
        <div className="startup-glow" aria-hidden />

        {particles.map((particle) => (
          <motion.span
            key={particle.id}
            className="startup-particle"
            style={{
              left: particle.left,
              top: particle.top,
              width: particle.size,
              height: particle.size,
            }}
            animate={{ opacity: [0.15, 0.7, 0.15], y: [0, -18, 0] }}
            transition={{
              duration: particle.duration,
              delay: particle.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ))}

        <div className="startup-content">
          <motion.div
            className="startup-logo"
            initial={{ scale: 0.86, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="startup-logo-mark">DA</span>
            <span className="startup-logo-text">DocAgent</span>
          </motion.div>

          <div className="startup-status" aria-live="polite">
            {phase === 'boot' &&
              BOOT_STEPS.map((step, index) => {
                const done = index < stepIndex;
                const active = index === stepIndex && stepIndex < BOOT_STEPS.length;
                return (
                  <motion.div
                    key={step.id}
                    className={`startup-line ${done ? 'done' : ''} ${active ? 'active' : ''}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: done || active ? 1 : 0.28, y: 0 }}
                    transition={{ duration: 0.35 }}
                  >
                    <span className="startup-prefix">{done ? '✓' : active ? '>' : '·'}</span>
                    <span>{step.label}{active ? '...' : done ? '' : ''}</span>
                    {active ? <span className="startup-cursor" /> : null}
                  </motion.div>
                );
              })}

            {phase !== 'boot' && (
              <motion.div
                className="startup-ready"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="startup-ready-check">✓</span>
                Ready
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
