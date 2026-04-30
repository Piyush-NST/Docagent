# DocAgent - Document Q&A with AI

A web app that lets you upload documents and ask questions about them. Uses Groq LLM for fast responses and Gemini for image OCR.
🔗 **Live Demo**: https://docagent-ai-rag-system.vercel.app/
<img width="1427" height="696" alt="Screenshot 2026-05-01 at 1 31 25 AM" src="https://github.com/user-attachments/assets/4a007575-fcfa-4b2d-9821-7a3021a59150" />


## Features

- Upload PDF, DOCX, and image files (PNG, JPG)
- Ask questions about uploaded documents  
- AI generates answers based only on document content (grounded responses)
- Shows which page/section the answer came from
- OCR support for scanned PDFs and images
- Modern dark themed UI

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript
- **Backend**: Next.js API Routes
- **AI/LLM**: Groq (llama-3.3-70b-versatile) - fast and free
- **OCR**: Google Gemini (gemini-2.0-flash) - for image text extraction
- **Storage**: In-memory (can use Azure Blob if configured)
- **Text Extraction**: unpdf for PDFs, mammoth for DOCX

## Getting Started

### Prerequisites

- Node.js 18+
- Groq API key (free from https://console.groq.com/keys)
- Gemini API key (free from https://aistudio.google.com/app/apikey) - optional, for image OCR

### Installation

```bash
cd doc-agent

npm install

cp .env.example .env.local
```

Add your API keys to `.env.local`:

```
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
```

Then start:

```bash
npm run dev
```

Open http://localhost:3000

## How It Works

### 1. Upload

User uploads a document. Gets stored in memory and assigned a unique ID.

### 2. Text Extraction

- **PDF**: Uses `unpdf` library to extract text. If PDF is scanned (no text), falls back to OCR using Gemini Vision
- **DOCX**: Uses `mammoth` library
- **Images**: Uses Gemini Vision API for OCR

### 3. Chunking & Embedding

Text is split into ~500 character chunks with overlap. Each chunk gets a local hash-based embedding (since Groq doesn't have embedding API).

### 4. Question Answering

When user asks a question:
1. Find relevant chunks using similarity search
2. Build prompt with chunks as context
3. Send to Groq LLM with grounding instructions
4. Return answer with source citations

### 5. Grounding

The AI only uses info from the document. If something isn't there, it says so instead of making stuff up.

## Project Structure

```
doc-agent/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── upload/route.ts    - handles file uploads
│   │   │   ├── chat/route.ts      - handles Q&A
│   │   │   └── documents/route.ts - list/delete docs
│   │   ├── page.tsx               - main page
│   │   └── globals.css            - styles
│   ├── components/
│   │   ├── DocumentUpload.tsx     - drag & drop upload
│   │   ├── ChatInterface.tsx      - chat UI
│   │   └── DocumentList.tsx       - doc list
│   └── lib/
│       ├── azure-blob.ts          - storage (in-memory or azure)
│       ├── azure-openai.ts        - groq client & embeddings
│       ├── document-processor.ts  - text extraction & chunking
│       └── vector-store.ts        - in-memory vector db
└── docs/
    └── ARCHITECTURE.md
```

## Example Questions

After uploading try asking:

- "What is this document about?"
- "Summarize the main points"
- "What are the key findings?"
- "Does it mention any numbers or dates?"

<img width="1427" height="900" alt="Screenshot 2026-05-01 at 1 31 46 AM" src="https://github.com/user-attachments/assets/ce1ef12f-4cfc-4cde-b5e3-d8f5c7381a08" />


