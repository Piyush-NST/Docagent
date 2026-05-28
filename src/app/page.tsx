import Link from 'next/link';
import AppChrome from '@/components/AppChrome';

const navItems = [
  { label: 'Features', href: '#features' },
  { label: 'Workflow', href: '#workflow' },
  { label: 'Trust', href: '#trust' },
];

const metrics = [
  { value: '8MB', label: 'safe upload limit' },
  { value: 'OCR', label: 'image-aware extraction' },
  { value: 'Sources', label: 'evidence-first answers' },
];

const features = [
  {
    index: '01',
    title: 'Source-grounded answers',
    body: 'Every response stays tied to indexed document context and visible source references.',
  },
  {
    index: '02',
    title: 'OCR-ready ingestion',
    body: 'Extract readable content from PDFs, DOCX files, and images with the existing assistant pipeline.',
  },
  {
    index: '03',
    title: 'Focused workspace',
    body: 'Keep upload, library, and Q&A tools in a dedicated assistant screen built for repeated use.',
  },
];

const values = [
  {
    label: 'Supported formats',
    value: 'PDF, DOCX, PNG, JPG',
    helper: 'Fast intake for common academic and business files.',
  },
  {
    label: 'Answer style',
    value: 'Grounded with sources',
    helper: 'Responses stay tied to indexed context.',
  },
  {
    label: 'Built for',
    value: 'Academic and business docs',
    helper: 'Designed for repeated document review workflows.',
  },
];

const footerGroups = [
  {
    title: 'Product',
    links: ['Assistant', 'Document Library', 'Grounded Chat'],
  },
  {
    title: 'Workflow',
    links: ['Upload', 'OCR', 'Sources'],
  },
  {
    title: 'Project',
    links: ['Architecture', 'API Routes', 'Local Mode'],
  },
];

export default function Home() {
  return (
    <AppChrome>
      <main className="relative z-[1] overflow-x-hidden px-4 pb-12 sm:px-6 lg:px-8">
        <section className="relative mx-auto max-w-[1180px] overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/72 shadow-[0_36px_120px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_68%_12%,rgba(34,211,238,0.28),transparent_28%),radial-gradient(circle_at_28%_28%,rgba(249,115,22,0.13),transparent_24%),radial-gradient(circle_at_48%_102%,rgba(124,58,237,0.24),transparent_35%),linear-gradient(135deg,rgba(2,6,23,0.35),rgba(8,8,18,0.96))]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.28)_0.55px,transparent_0.7px),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:3px_3px,70px_70px,70px_70px] opacity-[0.18] [mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.82),transparent_94%)]" />
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent" />

          <nav
            className="relative z-[2] mx-auto flex min-h-16 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6 lg:px-8"
            aria-label="Primary navigation"
          >
            <Link className="inline-flex items-center gap-3 whitespace-nowrap text-sm font-black text-white no-underline sm:text-base" href="/">
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-cyan-200/25 bg-gradient-to-br from-sky-500/35 to-violet-500/25 text-xs text-cyan-100 shadow-[0_0_24px_rgba(14,165,233,0.22)]">
                DA
              </span>
              DocAgent
            </Link>

            <div className="hidden items-center gap-7 lg:flex" aria-label="Home page sections">
              {navItems.map((item) => (
                <a
                  className="text-sm font-bold text-slate-200/68 no-underline transition-colors hover:text-white"
                  href={item.href}
                  key={item.label}
                >
                  {item.label}
                </a>
              ))}
            </div>

            <Link
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-white px-4 text-xs font-black text-slate-950 no-underline shadow-[0_14px_38px_rgba(14,165,233,0.16)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_48px_rgba(14,165,233,0.24)] sm:min-h-11 sm:px-5 sm:text-sm"
              href="/assistant"
            >
              <span className="sm:hidden">Open</span>
              <span className="hidden sm:inline">Open Assistant</span>
            </Link>
          </nav>

          <div className="relative z-[1] mx-auto flex max-w-[980px] flex-col items-center px-5 py-14 text-center sm:px-8 sm:py-16 lg:py-20">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-200/25 bg-sky-500/10 px-4 py-2 text-xs font-extrabold text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_30px_rgba(14,165,233,0.14)] backdrop-blur-md sm:text-sm">
              <span className="size-2 rounded-full bg-cyan-300 shadow-[0_0_18px_#22d3ee]" />
              AI document workspace
            </div>

            <h1 className="mx-auto max-w-[900px] text-balance font-serif text-5xl font-black leading-[1.02] tracking-normal text-white sm:text-6xl lg:text-7xl xl:text-8xl">
              Ask your documents.
              <span className="mt-2 block font-serif italic text-cyan-300 drop-shadow-[0_0_34px_rgba(19,199,246,0.24)]">
                Get grounded answers.
              </span>
            </h1>

            <p className="mt-6 max-w-[680px] text-balance text-base leading-7 text-slate-200/76 sm:text-lg">
              Upload files in the assistant workspace, ask natural questions, and get source-aware responses without
              digging through every page manually.
            </p>

            <Link
              className="mt-8 inline-flex min-h-[3.25rem] items-center justify-center gap-3 rounded-full bg-gradient-to-br from-cyan-300 via-sky-500 to-blue-400 px-8 text-base font-black text-slate-950 no-underline shadow-[0_20px_54px_rgba(14,165,233,0.32),inset_0_1px_0_rgba(255,255,255,0.42)] transition hover:-translate-y-1 hover:shadow-[0_26px_64px_rgba(14,165,233,0.4),inset_0_1px_0_rgba(255,255,255,0.54)]"
              href="/assistant"
            >
              Try Now
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </Link>

            <div className="mt-12 grid w-full max-w-[790px] grid-cols-1 overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:grid-cols-3">
              {metrics.map((metric) => (
                <div
                  className="border-b border-white/10 px-5 py-5 text-center last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
                  key={metric.value}
                >
                  <strong className="block font-serif text-3xl leading-none tracking-normal text-white sm:text-4xl">
                    {metric.value}
                  </strong>
                  <span className="mt-2 block text-sm text-slate-300/65">{metric.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative z-[2] mx-auto mt-16 w-full max-w-[1180px] scroll-mt-24 sm:mt-20" id="features">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/70">Core Capabilities</span>
              <h2 className="mt-3 font-serif text-3xl font-black tracking-normal text-white sm:text-4xl lg:text-5xl">
                Built for document Q&A.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-slate-300/64 sm:text-right">
              A focused landing page up front, with the full upload and chat workspace kept cleanly inside `/assistant`.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {features.map((feature) => (
              <article
                className="group relative min-h-[230px] overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.055] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.24)] backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:border-cyan-200/30 hover:bg-white/[0.075] hover:shadow-[0_28px_80px_rgba(14,165,233,0.16)]"
                key={feature.title}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(56,189,248,0.14),transparent_34%),radial-gradient(circle_at_100%_100%,rgba(168,85,247,0.12),transparent_38%)] opacity-70 transition group-hover:opacity-100" />
                <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/45 to-transparent" />
                <div className="relative">
                  <span className="inline-flex rounded-full border border-cyan-200/15 bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.12)]">
                    {feature.index}
                  </span>
                  <h3 className="mt-8 max-w-[18rem] font-serif text-2xl font-black leading-tight tracking-normal text-white">
                    {feature.title}
                  </h3>
                  <p className="mt-4 max-w-[27rem] text-[0.95rem] leading-7 text-slate-300/72">{feature.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          className="relative z-[2] mx-auto mt-16 grid w-full max-w-[1180px] scroll-mt-24 grid-cols-1 gap-8 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.3)] backdrop-blur-2xl sm:mt-20 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.74fr)] lg:p-10"
          id="workflow"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_6%_10%,rgba(249,115,22,0.14),transparent_30%),radial-gradient(circle_at_88%_18%,rgba(14,165,233,0.15),transparent_28%),radial-gradient(circle_at_50%_110%,rgba(124,58,237,0.16),transparent_36%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-orange-300/10 via-cyan-200/45 to-violet-300/10" />

          <div className="relative">
            <span className="inline-flex text-xs font-black uppercase tracking-[0.18em] text-violet-300">Product Value</span>
            <h2 className="mt-4 max-w-[700px] font-serif text-4xl font-black leading-[1.05] tracking-normal text-white sm:text-5xl lg:text-6xl">
              One focused route for work, one polished route for trust.
            </h2>
            <p className="mt-5 max-w-[680px] text-base leading-8 text-slate-300/72">
              The home page presents the product clearly while the actual assistant lives at `/assistant`, keeping uploads,
              document management, and chat interactions inside a dedicated workspace.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-black text-slate-950 no-underline transition hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(255,255,255,0.14)]"
                href="/assistant"
              >
                Launch workspace
              </Link>
              <a
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.045] px-5 text-sm font-black text-white no-underline transition hover:border-cyan-200/35 hover:bg-white/[0.075]"
                href="#features"
              >
                View features
              </a>
            </div>
          </div>

          <div className="relative grid gap-4 self-center" id="trust">
            {values.map((item) => (
              <div
                className="group rounded-[1.25rem] border border-white/10 bg-slate-950/48 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:-translate-y-0.5 hover:border-cyan-200/25 hover:bg-slate-950/62"
                key={item.label}
              >
                <span className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200/75">{item.label}</span>
                <strong className="mt-3 block font-serif text-xl font-black leading-tight tracking-normal text-white">
                  {item.value}
                </strong>
                <p className="mt-2 text-sm leading-6 text-slate-400">{item.helper}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="relative z-[2] mx-auto mt-16 w-full max-w-[1180px] overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/58 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.26)] backdrop-blur-2xl sm:mt-20 sm:p-8">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/55 to-transparent" />
          <div className="absolute -top-24 right-10 size-52 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative grid gap-10 lg:grid-cols-[1.1fr_1.8fr]">
            <div>
              <Link className="inline-flex items-center gap-3 text-lg font-black text-white no-underline" href="/">
                <span className="grid size-10 place-items-center rounded-full border border-cyan-200/25 bg-gradient-to-br from-sky-500/35 to-violet-500/25 text-sm text-cyan-100">
                  DA
                </span>
                DocAgent
              </Link>
              <p className="mt-4 max-w-sm text-sm leading-7 text-slate-300/70">
                A premium document assistant for turning dense files into grounded, source-aware answers.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-7 sm:grid-cols-3">
              {footerGroups.map((group) => (
                <div key={group.title}>
                  <h3 className="font-serif text-base font-black tracking-normal text-white">{group.title}</h3>
                  <div className="mt-4 grid gap-3">
                    {group.links.map((link) => (
                      <Link className="text-sm text-slate-400 no-underline transition hover:text-cyan-200" href="/assistant" key={link}>
                        {link}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mt-10 flex flex-col gap-3 border-t border-white/10 pt-5 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>© 2026 DocAgent. All rights reserved.</span>
            <span>Built for grounded document intelligence.</span>
          </div>
        </footer>
      </main>
    </AppChrome>
  );
}
