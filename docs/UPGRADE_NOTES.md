# Production hardening notes

See the Production Hardening Report in chat for the full write-up.

Quick facts:

- Persistence: Postgres via `DATABASE_URL` (required on Vercel); local default is `.data/` file store.
- AI providers: exact OpenRouter model for generative answers; Gemini for OCR and embeddings (`src/lib/gemini.ts`).
- Embeddings: `gemini-embedding-001` (real semantic); lexical fallback if embedding fails.
- Readiness includes `limited` for low processing coverage; OCR skipped ≠ OCR failed.
