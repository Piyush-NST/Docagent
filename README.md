# DocAgent - Document Q&A with AI

A premium document intelligence app for uploading files and asking grounded questions. Uses a pinned OpenRouter model for generative answers and Gemini for image OCR and semantic embeddings.

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
- **AI/LLM**: OpenRouter (`nvidia/nemotron-3-ultra-550b-a55b:free`)
- **OCR**: Google Gemini Vision — image/scanned text extraction
- **Storage**: In-memory (Azure Blob optional)
- **Text Extraction**: `unpdf` for PDFs, `mammoth` for DOCX

## Getting Started

### Prerequisites

- Node.js 18+
- OpenRouter API key (from https://openrouter.ai/settings/keys)
- Gemini API key for OCR and semantic embeddings (from https://aistudio.google.com/app/apikey)

### Installation

```bash
cd docagent-ai-rag-system

npm install

cp .env.example .env.local
```

Add your API keys to `.env.local`:

```
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
GEMINI_API_KEY=your_gemini_key
GEMINI_OCR_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
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

Text is split into page-aware chunks with overlap. Each chunk receives a Gemini semantic embedding when the configured project has embedding access; lexical retrieval remains available as a fallback.

### 4. Question Answering

1. Find relevant chunks via similarity search
2. Build a prompt with those chunks as context
3. Send synthesis questions to the exact configured OpenRouter model with grounding instructions
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

DocAgent uses two explicitly scoped providers (`src/lib/gemini.ts`):

- Grounded generative answers: `OPENROUTER_MODEL` (pinned to `nvidia/nemotron-3-ultra-550b-a55b:free`)
- OCR fallback: `GEMINI_OCR_MODEL` (default `gemini-2.5-flash`)
- Semantic embeddings: `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`)

The OpenRouter request contains one explicit `:free` model, no model fallback list, and provider fallbacks are disabled. NVIDIA's free endpoint does not currently accept OpenRouter's provider-side JSON response parameter, so DocAgent enforces JSON through its prompt and rejects anything that fails the existing structured parser and intent policy. Deterministic fact extraction runs locally before the generative branch. Gemini embeddings use their own key and retain lexical retrieval as a fallback.

When OpenRouter generation is unavailable, DocAgent labels the response as a local grounded fallback. It never sends provider error text or malformed model output to the answer body.

OpenRouter's NVIDIA free-endpoint notice says not to submit confidential information or personal data because free-endpoint prompts may be logged and used to improve NVIDIA products. Use this configuration only for documents you are authorized to transmit under those terms.
## Example Questions

After uploading, try:

- "What is this document about?"
- "Summarize the main points"
- "What are the key findings?"
- "Does it mention any numbers or dates?"
