'use client';

import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type PanInfo,
} from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScrollyStep } from '@/components/ScrollyStory';

type FeatureSliderProps = {
  steps: ScrollyStep[];
  eyebrow?: string;
  heading?: string;
};

function VisualChrome({ label, children, footer }: { label: string; children: React.ReactNode; footer?: string }) {
  return (
    <div className="story-visual">
      <div className="story-visual-bar">
        <span />
        <span />
        <span />
        <em>{label}</em>
      </div>
      <div className="story-visual-body">{children}</div>
      {footer ? <div className="story-visual-footer">{footer}</div> : null}
    </div>
  );
}

export function FeatureVisual({ type }: { type: ScrollyStep['visual'] }) {
  if (type === 'grounded') {
    return (
      <VisualChrome label="Grounded Chat" footer="Evidence locked to indexed chunks">
        <div className="story-bubble story-bubble-user">What are the key findings?</div>
        <div className="story-bubble story-bubble-ai">
          <strong>Grounded answer</strong>
          <p>Revenue grew 28% QoQ, driven by enterprise renewals and lower churn.</p>
          <div className="story-source-row">
            <span>p.4</span>
            <span>p.12</span>
            <span>Sources</span>
          </div>
        </div>
      </VisualChrome>
    );
  }

  if (type === 'ocr') {
    return (
      <VisualChrome label="OCR Engine" footer="Scans recovered · text ready for indexing">
        <div className="story-ocr-grid">
          <div className="story-ocr-preview">
            <div className="story-ocr-page">
              <div className="story-ocr-scan" />
              <div className="story-line" />
              <div className="story-line short" />
              <div className="story-line" />
              <div className="story-line short" />
            </div>
            <div className="story-ocr-badge">IMG → TEXT</div>
          </div>
          <div className="story-progress-list">
            <div className="done">✓ Detected scanned PDF</div>
            <div className="done">✓ OCR fallback applied</div>
            <div className="done">✓ 18 pages extracted</div>
            <div className="active">› Building embeddings</div>
            <div className="story-mini-meter">
              <span style={{ width: '78%' }} />
            </div>
          </div>
        </div>
      </VisualChrome>
    );
  }

  if (type === 'pipeline') {
    return (
      <VisualChrome label="Document Pipeline" footer="Gemini · OCR · Vectors">
        <div className="story-pipe-list">
          {[
            { n: 1, title: 'Upload', detail: 'File secured in workspace', state: 'done' },
            { n: 2, title: 'Parse', detail: 'Text + OCR extraction', state: 'done' },
            { n: 3, title: 'Index', detail: 'Vectors ready for retrieval', state: 'done' },
            { n: 4, title: 'Ask', detail: 'Grounded reply unlocked', state: 'active' },
          ].map((step) => (
            <div key={step.title} className={`story-pipe-step ${step.state}`}>
              <span>{step.n}</span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </div>
              <em>{step.state === 'done' ? '✓' : '…'}</em>
            </div>
          ))}
        </div>
      </VisualChrome>
    );
  }

  if (type === 'sources') {
    return (
      <VisualChrome label="Evidence Layer" footer="Inspect chunks before you trust a reply">
        <div className="story-source-list">
          <div className="story-source-card featured">
            <div className="story-source-top">
              <small>Chunk 12 · page 7</small>
              <b>0.91</b>
            </div>
            <p>Matched to query intent with high retrieval confidence.</p>
            <div className="story-source-row">
              <span>Primary</span>
              <span>Cited</span>
            </div>
          </div>
          <div className="story-source-card">
            <div className="story-source-top">
              <small>Chunk 18 · page 11</small>
              <b>0.84</b>
            </div>
            <p>Supporting evidence with citation tags attached.</p>
            <div className="story-source-row">
              <span>Support</span>
            </div>
          </div>
        </div>
      </VisualChrome>
    );
  }

  if (type === 'workspace') {
    return (
      <VisualChrome label="Command Center" footer="Library · readiness · grounded chat">
        <div className="story-workspace-grid">
          <div className="story-side">
            <div className="story-side-label">Library</div>
            <div className="story-file active">
              <b>PDF</b>
              <span>q3-report.pdf</span>
            </div>
            <div className="story-file">
              <b>DOC</b>
              <span>notes.docx</span>
            </div>
            <div className="story-file">
              <b>IMG</b>
              <span>scan.png</span>
            </div>
          </div>
          <div className="story-main">
            <div className="story-side-label">Selected document</div>
            <strong className="story-main-title">q3-report.pdf</strong>
            <div className="story-line" />
            <div className="story-line short" />
            <div className="story-line" />
            <div className="story-metric-row">
              <span>24 chunks</span>
              <span>OCR used</span>
              <span className="ok">Ready</span>
            </div>
          </div>
        </div>
      </VisualChrome>
    );
  }

  return (
    <VisualChrome label="Document Ready" footer="Indexed and available for grounded chat">
      <div className="story-ready-block">
        <div className="story-ready-ring">
          <span>✓</span>
        </div>
        <strong>Document ready</strong>
        <p>Indexed and available for grounded chat</p>
      </div>
    </VisualChrome>
  );
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export default function FeatureSlider({
  steps,
  eyebrow = 'Features',
  heading = 'Built for grounded document work',
}: FeatureSliderProps) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const wheelLock = useRef(false);
  const draggingProgress = useRef(false);

  const total = steps.length;
  const step = steps[index];
  const progress = total > 1 ? index / (total - 1) : 0;

  const dragX = useMotionValue(0);
  const parallaxXSource = useTransform(dragX, [-240, 240], [-18, 18]);
  const parallaxRotateSource = useTransform(dragX, [-240, 240], [4, -4]);
  const parallaxX = useSpring(parallaxXSource, {
    stiffness: 220,
    damping: 28,
    mass: 0.4,
  });
  const parallaxRotate = useSpring(parallaxRotateSource, {
    stiffness: 220,
    damping: 28,
    mass: 0.4,
  });

  const goTo = useCallback(
    (next: number, dir?: number) => {
      const clamped = Math.max(0, Math.min(total - 1, next));
      if (clamped === index) return;
      setDirection(dir ?? (clamped > index ? 1 : -1));
      setIndex(clamped);
      dragX.set(0);
    },
    [dragX, index, total],
  );

  const goPrev = useCallback(() => goTo(index - 1, -1), [goTo, index]);
  const goNext = useCallback(() => goTo(index + 1, 1), [goTo, index]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    let inView = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting && entry.intersectionRatio > 0.35;
      },
      { threshold: [0.35, 0.6] },
    );
    observer.observe(node);

    const onKey = (event: KeyboardEvent) => {
      if (!inView) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (!inView || wheelLock.current) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal && !event.shiftKey) return;
      const dominant = horizontal ? event.deltaX : event.deltaY;
      if (Math.abs(dominant) < 16) return;

      event.preventDefault();
      wheelLock.current = true;
      if (dominant > 0) goNext();
      else goPrev();
      window.setTimeout(() => {
        wheelLock.current = false;
      }, 520);
    };

    window.addEventListener('keydown', onKey);
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', onKey);
      node.removeEventListener('wheel', onWheel);
    };
  }, [goNext, goPrev]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const threshold = 72;
    const velocity = info.velocity.x;
    if (info.offset.x < -threshold || velocity < -450) goNext();
    else if (info.offset.x > threshold || velocity > 450) goPrev();
    else dragX.set(0);
  };

  const setFromProgress = (clientX: number) => {
    const track = trackRef.current;
    if (!track || total < 2) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const next = Math.round(ratio * (total - 1));
    goTo(next, next >= index ? 1 : -1);
  };

  const duration = reduceMotion ? 0.01 : 0.5;
  const ease = [0.22, 1, 0.36, 1] as const;

  const copyVariants = {
    enter: (dir: number) => ({
      opacity: 0,
      x: reduceMotion ? 0 : dir > 0 ? 36 : -36,
      filter: reduceMotion ? 'blur(0px)' : 'blur(6px)',
    }),
    center: {
      opacity: 1,
      x: 0,
      filter: 'blur(0px)',
    },
    exit: (dir: number) => ({
      opacity: 0,
      x: reduceMotion ? 0 : dir > 0 ? -28 : 28,
      filter: reduceMotion ? 'blur(0px)' : 'blur(4px)',
    }),
  };

  const visualVariants = {
    enter: (dir: number) => ({
      opacity: 0,
      scale: reduceMotion ? 1 : 0.94,
      rotateY: reduceMotion ? 0 : dir > 0 ? -8 : 8,
      y: reduceMotion ? 0 : 12,
    }),
    center: {
      opacity: 1,
      scale: 1,
      rotateY: 0,
      y: 0,
    },
    exit: (dir: number) => ({
      opacity: 0,
      scale: reduceMotion ? 1 : 0.96,
      rotateY: reduceMotion ? 0 : dir > 0 ? 6 : -6,
      y: reduceMotion ? 0 : -8,
    }),
  };

  return (
    <div className="feature-slider" ref={rootRef}>
      <div className="feature-slider-heading">
        <p className="landing-kicker">{eyebrow}</p>
        <h2>{heading}</h2>
      </div>

      <motion.div
        className="feature-slider-stage"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        style={{ x: dragX }}
        onDragEnd={onDragEnd}
        whileTap={{ cursor: 'grabbing' }}
      >
        <div className="feature-slider-grid">
          <div className="feature-slider-copy">
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={step.id}
                className="feature-slider-copy-inner"
                custom={direction}
                variants={copyVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration, ease }}
              >
                {step.kicker ? <span className="feature-slider-kicker">{step.kicker}</span> : null}
                <h3>{step.title}</h3>
                {step.description ? <p>{step.description}</p> : null}
                {step.tags.length > 0 ? (
                  <div className="feature-slider-tags">
                    {step.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="feature-slider-visual-wrap" style={{ perspective: 1200 }}>
            <div className="feature-slider-glow" aria-hidden />
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={step.id}
                className="feature-slider-visual"
                custom={direction}
                variants={visualVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: duration * 1.05, ease }}
                style={{ transformStyle: 'preserve-3d' }}
              >
                <motion.div
                  style={{
                    x: parallaxX,
                    rotateY: parallaxRotate,
                  }}
                >
                  <FeatureVisual type={step.visual} />
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      <div className="feature-slider-controls">
        <div className="feature-slider-nav">
          <button
            type="button"
            className="feature-slider-arrow"
            onClick={goPrev}
            disabled={index === 0}
            aria-label="Previous feature"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M15 6 9 12l6 6" />
            </svg>
          </button>
          <button
            type="button"
            className="feature-slider-arrow"
            onClick={goNext}
            disabled={index === total - 1}
            aria-label="Next feature"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className="feature-slider-progress">
          <span className="feature-slider-count" aria-live="polite">
            {pad(index + 1)} / {pad(total)}
          </span>

          <div
            className="feature-slider-track"
            ref={trackRef}
            role="slider"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={index + 1}
            aria-label="Feature progress"
            tabIndex={0}
            onPointerDown={(event) => {
              draggingProgress.current = true;
              setFromProgress(event.clientX);
              (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!draggingProgress.current) return;
              setFromProgress(event.clientX);
            }}
            onPointerUp={() => {
              draggingProgress.current = false;
            }}
            onPointerCancel={() => {
              draggingProgress.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') goNext();
              if (event.key === 'ArrowLeft') goPrev();
            }}
          >
            <motion.span
              className="feature-slider-fill"
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: reduceMotion ? 0.01 : 0.45, ease }}
            />
            <motion.span
              className="feature-slider-thumb"
              animate={{ left: `${progress * 100}%` }}
              transition={{ duration: reduceMotion ? 0.01 : 0.45, ease }}
            />
          </div>

          <div className="feature-slider-dots" role="tablist" aria-label="Features">
            {steps.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={i === index ? 'is-active' : ''}
                onClick={() => goTo(i)}
                aria-label={`Go to ${item.title}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
