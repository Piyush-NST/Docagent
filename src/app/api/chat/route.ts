// chat api

import { NextRequest, NextResponse } from 'next/server';
import { searchDocument, getDocumentChunks } from '@/lib/vector-store';
import { generateGroundedResponse } from '@/lib/azure-openai';
import { getDocumentRecord } from '@/lib/document-registry';
import { isDocumentReady } from '@/lib/document-status';

interface ChatRequest {
  documentId: string;
  question: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();

    if (!body.documentId) {
      return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    }

    if (!body.question || body.question.trim() === '') {
      return NextResponse.json({ error: 'question required' }, { status: 400 });
    }

    const { documentId, question } = body;
    console.log(`Question for doc ${documentId}: "${question}"`);

    const record = getDocumentRecord(documentId);
    if (record && !isDocumentReady(record.status)) {
      return NextResponse.json(
        {
          error: 'DOCUMENT_NOT_READY',
          message: 'This document does not contain enough readable text to answer questions.',
          status: record.status,
        },
        { status: 409 },
      );
    }

    const indexedChunks = getDocumentChunks(documentId);
    if (indexedChunks.length === 0) {
      return NextResponse.json(
        {
          error: 'DOCUMENT_NOT_READY',
          message: 'This document does not contain enough readable text to answer questions.',
          status: record?.status || 'ocr_failed',
        },
        { status: 409 },
      );
    }

    let relevantChunks = await searchDocument(documentId, question, 5, 0.1);

    if (relevantChunks.length === 0) {
      console.log('Using all chunks as fallback');
      relevantChunks = indexedChunks.slice(0, 5).map((c) => ({
        id: c.id,
        documentId: c.documentId,
        content: c.content,
        page: c.page,
        section: c.section,
        relevance: 0.8,
        metadata: c.metadata,
      }));
    }

    const response = await generateGroundedResponse(
      question,
      relevantChunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        page: chunk.page,
        section: chunk.section,
        relevance: chunk.relevance,
      })),
    );

    const sources = response.sources.map((src, i) => ({
      ...src,
      preview: relevantChunks[i]?.content.substring(0, 150) + '...',
    }));

    return NextResponse.json({
      success: true,
      answer: response.answer,
      sources,
      isGrounded: response.isGrounded,
      documentId,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      {
        error: 'Chat failed',
        message: error instanceof Error ? error.message : 'Something went wrong',
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Chat API - ask questions about your documents',
    usage: {
      method: 'POST',
      body: {
        documentId: 'string - the document ID',
        question: 'string - your question',
      },
    },
  });
}
