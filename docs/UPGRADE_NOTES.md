# Production hardening notes

See the Production Hardening Report in chat for the full write-up.

Quick facts:

- Persistence: Postgres via `DATABASE_URL` (required on Vercel); local default is `.data/` file store.
- AI providers: exact OpenRouter models for generative answers and OCR; Gemini for optional embeddings.
- Embeddings: `gemini-embedding-001` (real semantic); lexical fallback if embedding fails.
- Readiness includes `limited` for low processing coverage; OCR skipped ≠ OCR failed.
