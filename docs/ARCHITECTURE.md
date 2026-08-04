# Architecture

## Overview

DocAgent is a grounded document intelligence system. It validates whether a document was actually readable, persists metadata + chunks, retrieves evidence with hybrid ranking, then asks Gemini to answer only from that evidence.

## Pipeline

```
Browser
↓
Next.js API
↓
Validation + content hash
↓
Document Processor
├─ native page extraction
└─ OCR fallback (budgeted)
↓
Usable-text validation
↓
Readiness calculation
↓
Persistent Document / Chunk Store
├─ Postgres (DATABASE_URL) — required on Vercel
└─ File store (.data/) — local default
↓
Gemini embeddings (gemini-embedding-001) + lexical tokens
↓
Hybrid Retriever
↓
Evidence
↓
Gemini grounded generation
↓
Answer + citations (from retrieved evidence only)
```

## What persists

| Data | Where |
|------|--------|
| Document metadata / readiness / hash | Postgres or `.data/documents` |
| Chunks + embeddings + page metadata | Postgres or `.data/chunks` |
| Original binaries | Azure Blob (if configured) or `.data/blobs` |

## Serverless behavior

- Document registry and vector index are **not** process memory in normal operation.
- On **Vercel**, `DATABASE_URL` is required. Without it, APIs return `503 PERSISTENCE_UNAVAILABLE`.
- Local/dev defaults to durable JSON under `.data/` (survives process restart on the same machine).
- `DOCAGENT_STORAGE=memory` is for tests only.

## AI provider

DocAgent uses explicit provider boundaries:

- Generative answers: OpenRouter `OPENROUTER_MODEL` (default `nvidia/nemotron-3-ultra-550b-a55b:free`) with no model/provider fallback
- OCR fallback: `GEMINI_OCR_MODEL` (default `gemini-2.5-flash`)
- OCR: same chat model (vision) via `document-processor.ts`
- Embeddings: `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`)

There is no Groq, random OpenRouter model, paid-model fallback, Azure OpenAI, or direct OpenAI chat path. API keys are server-side only.

## Retrieval

1. Embed the query with Gemini (`RETRIEVAL_QUERY`)
2. Cosine similarity vs stored chunk embeddings
3. Lexical token overlap
4. Hybrid blend (`src/lib/config/retrieval.ts`)
5. Near-duplicate dedupe
6. COMPARE mode: diversify evidence across selected documents
7. If embeddings unavailable → lexical-only (reported as `retrievalMode`)

## Readiness

| Status | Meaning |
|--------|---------|
| Ready | High processing coverage, indexed |
| Ready with warnings | Mostly usable; some pages incomplete |
| Limited | Usable content exists but coverage too low for whole-document claims |
| Failed / OCR Failed | No reliable content |

Thresholds live in `src/lib/config/readiness.ts`.

OCR skipped (budget) is tracked separately from OCR failed.

## Security notes

- No multi-user auth / tenant isolation — single shared workspace.
- Document text is treated as untrusted data in prompts.
- Persistence errors never return raw SQL / connection strings to the client.

## Limitations

- Embedding API cost/latency on large uploads
- OCR page budget (`DOCAGENT_MAX_OCR_PAGES`)
- Complex DOCX tables may still flatten
- File store is not multi-instance safe (use Postgres on Vercel)
