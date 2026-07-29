import Link from 'next/link';
import AppChrome from '@/components/AppChrome';
import LandingMotion from '@/components/LandingMotion';
import ScrollyStory, { type ScrollyStep } from '@/components/ScrollyStory';

const navItems = [
  { label: 'About', href: '#about' },
  { label: 'Features', href: '#features' },
  { label: 'Workspace', href: '#workflow' },
];

const featureSteps: ScrollyStep[] = [
  {
    id: 'grounded',
    kicker: 'Feature 01',
    title: 'Source-grounded answers',
    description: 'Ask questions and get replies tied to indexed document context—with page-level citations.',
    tags: ['Citations', 'No hallucination', 'Page-aware'],
    bullets: [],
    panelTitle: 'Grounded Chat',
    panelBody: 'Ask questions and receive source-backed answers with page-level evidence.',
    panelMeta: 'Assistant · Live workspace',
    visual: 'grounded',
  },
  {
    id: 'ocr',
    kicker: 'Feature 02',
    title: 'OCR-ready ingestion',
    description: 'Extract readable text from PDFs, DOCX, and scans—even when native text is missing.',
    tags: ['OCR fallback', 'Multi-format'],
    bullets: [],
    panelTitle: 'Ingestion Engine',
    panelBody: 'Parse, OCR, and prepare documents for grounded retrieval in one pipeline.',
    panelMeta: 'Upload · Extract · Index',
    visual: 'ocr',
  },
  {
    id: 'pipeline',
    kicker: 'Feature 03',
    title: 'Document pipeline',
    description: 'One clear path from upload through indexing to a grounded answer.',
    tags: ['Upload', 'Index', 'Retrieve'],
    bullets: [],
    panelTitle: 'Pipeline',
    panelBody: 'Four clear stages take a raw file to a chat-ready knowledge source.',
    panelMeta: 'Gemini · OCR · Vectors',
    visual: 'pipeline',
  },
  {
    id: 'sources',
    kicker: 'Feature 04',
    title: 'Inspectable retrieval',
    description: 'See which chunks shaped an answer and how strongly they matched.',
    tags: ['Chunk previews', 'Confidence'],
    bullets: [],
    panelTitle: 'Evidence Layer',
    panelBody: 'Inspect matched chunks, pages, and confidence before you trust a reply.',
    panelMeta: 'Retrieval · Verification',
    visual: 'sources',
  },
  {
    id: 'workspace',
    kicker: 'Feature 05',
    title: 'Focused workspace',
    description: 'Upload, library, and grounded chat in one calm surface.',
    tags: ['Library', 'Readiness'],
    bullets: [],
    panelTitle: 'Command Center',
    panelBody: 'A calm workspace for library management and grounded conversations.',
    panelMeta: 'Assistant · Production UI',
    visual: 'workspace',
  },
];

export default function Home() {
  return (
    <AppChrome>
      <LandingMotion>
        <main className="landing">
          <nav className="landing-nav" aria-label="Primary">
            <Link className="landing-brand" href="/">
              <span className="landing-mark">DA</span>
              <span>DocAgent</span>
            </Link>

            <div className="landing-nav-links">
              {navItems.map((item) => (
                <a key={item.label} href={item.href}>
                  {item.label}
                </a>
              ))}
            </div>

            <Link className="landing-nav-cta" href="/assistant">
              Let&apos;s Build
            </Link>
          </nav>

          <section className="landing-hero">
            <h1 className="landing-title">DocAgent</h1>
            <p className="landing-subtitle">
              Focused on <strong>Document Intelligence</strong>
            </p>

            <div className="landing-actions">
              <Link className="landing-btn-primary" href="/assistant">
                View Workspace →
              </Link>
              <a className="landing-btn-secondary" href="#features">
                Explore Features
              </a>
            </div>
          </section>

          <section className="landing-section" id="about">
            <p className="landing-kicker">About</p>
            <h2>Ask your documents. Get grounded answers.</h2>
            <p className="landing-copy">
              Upload files, run OCR-aware extraction, and chat with source-backed responses — designed like a real AI
              product, not a demo.
            </p>
          </section>

          <ScrollyStory id="features" eyebrow="Features" steps={featureSteps} />

          <section className="landing-section landing-cta-band" id="workflow">
            <p className="landing-kicker">Workspace</p>
            <h2>One polished surface for upload, index, and chat.</h2>
            <Link className="landing-btn-primary" href="/assistant">
              Launch Assistant →
            </Link>
          </section>

          <footer className="landing-footer">
            <span>© 2026 DocAgent</span>
            <span>Grounded document intelligence</span>
          </footer>
        </main>
      </LandingMotion>
    </AppChrome>
  );
}
