# DocAgent - Document Q&A with AI

A premium document intelligence app for uploading files and asking grounded questions. Uses Gemini for answers and image OCR.

🔗 **Live Demo**: https://docagent-ai-rag-system.vercel.app/

## Features

- Upload PDF, DOCX, and image files (PNG, JPG)
- Ask questions about uploaded documents
- AI answers grounded in document content only
- Page/section citations on replies
- OCR for scanned PDFs and images
- Premium dark SaaS UI (startup sequence, feature slider, glass upload)
- Document-readiness metrics after upload
- Structured answer cards with source chips

## Tech Stack

- **Frontend**: Next.js, React, TypeScript, Framer Motion
- **Backend**: Next.js API Routes
- **AI/LLM**: Google Gemini (`gemini-2.0-flash`)
- **OCR**: Google Gemini Vision — image/scanned text extraction
- **Storage**: In-memory (Azure Blob optional)
- **Text Extraction**: `unpdf` for PDFs, `mammoth` for DOCX

## Getting Started

### Prerequisites

- Node.js 18+
- Gemini API key (from https://aistudio.google.com/app/apikey)

### Installation

```bash
cd docagent-ai-rag-system

npm install

cp .env.example .env.local
```

Add your API keys to `.env.local`:

```
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.0-flash
```

Then start:

```bash
npm run dev
```

Open http://localhost:3000

## How It Works

### 1. Upload

Upload a document. It is stored and assigned a unique ID.

### 2. Text Extraction

- **PDF**: `unpdf` extraction; OCR fallback via Gemini Vision for scans
- **DOCX**: `mammoth`
- **Images**: Gemini Vision OCR

### 3. Chunking & Embedding

Text is split into ~500 character chunks with overlap. Each chunk gets a local hash-based embedding for lightweight similarity search.

### 4. Question Answering

1. Find relevant chunks via similarity search
2. Build a prompt with those chunks as context
3. Send to Gemini with grounding instructions
4. Return the answer with source citations

### 5. Grounding

The model only uses document content. If something is not present, it says so instead of inventing an answer.

## Project Structure

```
docagent-ai-rag-system/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── upload/route.ts
│   │   │   ├── chat/route.ts
│   │   │   └── documents/route.ts
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── StartupScreen.tsx
│   │   ├── FeatureSlider.tsx
│   │   ├── AssistantWorkspace.tsx
│   │   ├── DocumentUpload.tsx
│   │   ├── ChatInterface.tsx
│   │   └── …
│   └── lib/
│       ├── gemini.ts
│       ├── azure-blob.ts
│       ├── document-processor.ts
│       ├── vector-store.ts
│       └── store/          # postgres | file | memory persistence
└── docs/
    └── ARCHITECTURE.md
```

## Persistence (important for Vercel)

- Local default: durable JSON under `.data/`
- Production on Vercel: set `DATABASE_URL` (Postgres / Neon). Schema auto-applies on first use (`db/migrations/001_init.sql`).
- Without `DATABASE_URL` on Vercel, upload/chat return `503 PERSISTENCE_UNAVAILABLE` (no silent in-memory fallback).

## AI provider

DocAgent uses **Google Gemini only** (`src/lib/gemini.ts`):

- Chat + OCR: `GEMINI_MODEL`
- Semantic embeddings: `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`)
## Example Questions

After uploading, try:

- "What is this document about?"
- "Summarize the main points"
- "What are the key findings?"
- "Does it mention any numbers or dates?"

## Contributors

- [Prerak Arya](https://github.com/prerak2612) — Creator and maintainer
