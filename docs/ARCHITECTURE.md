# Architecture

## Overview

DocAgent uses RAG (Retrieval Augmented Generation) to answer questions about documents. We extract text, chunk it, and use those chunks as context when generating answers.

## Current Implementation

```
User --> [Next.js Frontend] --> [API Routes]
                                    |
                                    v
                            [Document Processing]
                                    |
                    +---------------+---------------+
                    |               |               |
                    v               v               v
             [In-Memory Store]  [Vector Store]    [Gemini LLM]
             (document files)   (chunks + embed)  (chat responses)
                                    |
                                    v
                              [Gemini Vision]
                              (OCR for images)
```

## Components

### Frontend

- **page.tsx**: Main layout with state management
- **DocumentUpload.tsx**: Drag & drop file upload with toast notifications
- **ChatInterface.tsx**: Chat UI showing messages and sources
- **DocumentList.tsx**: List of uploaded documents

### API Routes

- **/api/upload**: Receives file, extracts text, chunks it, stores embeddings
- **/api/chat**: Takes question, finds relevant chunks, calls Gemini, returns answer
- **/api/documents**: List all docs or delete a doc

### Libraries

- **azure-blob.ts**: Storage layer. Uses in-memory Map by default. Can switch to Azure Blob if connection string provided.
- **azure-openai.ts**: AI client. Uses Gemini for chat responses (`GEMINI_MODEL`, default `gemini-2.0-flash`) and local hash-based embeddings for lightweight retrieval.
- **document-processor.ts**: Extracts text from PDF (unpdf), DOCX (mammoth), images (Gemini Vision OCR). Chunks text into ~500 char pieces.
- **vector-store.ts**: Stores chunks with embeddings in memory. Does similarity search to find relevant chunks.

## How Processing Works

### Upload Flow

1. File comes in via FormData
2. Store original file (in-memory or Azure Blob)
3. Extract text based on file type:
   - PDF: try unpdf first, if scanned use Gemini OCR on each page
   - DOCX: use mammoth
   - Image: use Gemini Vision
4. Split text into chunks (~500 chars, 50 char overlap)
5. Generate embedding for each chunk (local hash method)
6. Store chunks in vector store
7. Return success with doc ID

### Chat Flow

1. User sends question + document ID
2. Search vector store for relevant chunks (top 5)
3. If small document, just use all chunks
4. Build prompt with chunks as context
5. Call Gemini with grounding instructions
6. Return answer + source references

## Why These Choices

### Why Gemini?
- Free tier
- Good text and vision models
- One provider supports both grounded answers and OCR fallback

### Why local embeddings?
- Hash-based method works ok for small docs
- For production would use OpenAI or Gemini embeddings

### Why in-memory storage?
- Simple for prototype
- No database setup needed
- For production would use Azure AI Search or similar

## Chunk Size

Using 500 chars with 50 char overlap because:
- Small enough to be specific
- Large enough to have context
- Overlap prevents cutting sentences

## Files That Matter

```
src/lib/azure-openai.ts    - Gemini client, embedding function
src/lib/document-processor.ts - text extraction, ocr, chunking
src/lib/vector-store.ts    - chunk storage and search
src/app/api/chat/route.ts  - main q&a logic
```
