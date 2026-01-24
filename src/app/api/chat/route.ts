// chat api

import { NextRequest, NextResponse } from 'next/server';
import { searchDocument } from '@/lib/vector-store';
import { generateGroundedResponse } from '@/lib/azure-openai';

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

    let relevantChunks = await searchDocument(documentId, question, 5, 0.1);

    // fallback if no chunks found
    if (relevantChunks.length === 0) {
      const { getDocumentChunks } = await import('@/lib/vector-store');
      const allChunks = getDocumentChunks(documentId);
      
      if (allChunks.length > 0) {
        console.log('Using all chunks as fallback');
        relevantChunks = allChunks.slice(0, 5).map(c => ({
          id: c.id,
          documentId: c.documentId,
          content: c.content,
          page: c.page,
          section: c.section,
          relevance: 0.8,
          metadata: c.metadata,
        }));
      }
    }

    if (relevantChunks.length === 0) {
      return NextResponse.json({
        success: true,
        answer: 'I could not find any content in this document. Please try re-uploading the file.',
        sources: [],
        isGrounded: false,
        documentId,
      });
    }

    const response = await generateGroundedResponse(
      question,
      relevantChunks.map(chunk => ({
        id: chunk.id,
        content: chunk.content,
        page: chunk.page,
        section: chunk.section,
        relevance: chunk.relevance,
      }))
    );

    const sources = response.sources.map((src, i) => ({
      ...src,
      preview: relevantChunks[i]?.content.substring(0, 150) + '...',
    }));

    return NextResponse.json({
      success: true,
      answer: response.answer,
      sources: sources,
      isGrounded: response.isGrounded,
      documentId,
    });

  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { 
        error: 'Chat failed',
        message: error instanceof Error ? error.message : 'Something went wrong'
      },
      { status: 500 }
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
