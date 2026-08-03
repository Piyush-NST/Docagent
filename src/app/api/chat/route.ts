// chat api

import { NextRequest, NextResponse } from 'next/server';
import { searchDocument, searchDocuments, getDocumentChunks } from '@/lib/vector-store';
import { generateGroundedResponse, type ChatMode } from '@/lib/gemini';
import { getDocumentRecord } from '@/lib/document-registry';
import {
  coverageLabelFromReadiness,
  isDocumentQueryable,
} from '@/lib/document-status';
import { RETRIEVAL_CONFIG } from '@/lib/config/retrieval';
import { isPersistenceError } from '@/lib/store';

interface ChatRequest {
  documentId?: string;
  documentIds?: string[];
  question: string;
  mode?: ChatMode;
}

function normalizeMode(mode: unknown): ChatMode {
  if (mode === 'summarize' || mode === 'compare' || mode === 'extract' || mode === 'ask') return mode;
  return 'ask';
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const mode = normalizeMode(body.mode);
    const question = body.question?.trim() || '';

    if (!question) {
      return NextResponse.json({ error: 'question required', message: 'A question is required.' }, { status: 400 });
    }

    if (question.length > 4000) {
      return NextResponse.json(
        { error: 'QUESTION_TOO_LONG', message: 'Please shorten your question and try again.' },
        { status: 400 },
      );
    }

    const documentIds = Array.from(
      new Set(
        (body.documentIds && body.documentIds.length > 0
          ? body.documentIds
          : body.documentId
            ? [body.documentId]
            : []
        ).filter(Boolean),
      ),
    );

    if (documentIds.length === 0) {
      return NextResponse.json(
        { error: 'documentId required', message: 'Select at least one document.' },
        { status: 400 },
      );
    }

    if (mode === 'compare' && documentIds.length < 2) {
      return NextResponse.json(
        {
          error: 'COMPARE_NEEDS_DOCS',
          message: 'Compare mode needs at least two ready documents.',
        },
        { status: 400 },
      );
    }

    console.log(`Question (${mode}) for docs [${documentIds.join(', ')}]: "${question}"`);

    const records = [];
    for (const documentId of documentIds) {
      const record = await getDocumentRecord(documentId);
      const chunks = await getDocumentChunks(documentId);

      if ((record && !isDocumentQueryable(record.status)) || chunks.length === 0) {
        return NextResponse.json(
          {
            error: 'DOCUMENT_NOT_READY',
            message: 'One or more selected documents are not ready for questions.',
            status: record?.status || 'ocr_failed',
            documentId,
          },
          { status: 409 },
        );
      }
      if (record) records.push(record);
    }

    const topK =
      mode === 'summarize'
        ? RETRIEVAL_CONFIG.summarizeTopK
        : mode === 'compare'
          ? RETRIEVAL_CONFIG.compareTopK
          : documentIds.length > 1
            ? RETRIEVAL_CONFIG.multiDocTopK
            : RETRIEVAL_CONFIG.defaultTopK;

    const outcome =
      documentIds.length === 1
        ? await searchDocument(documentIds[0], question, topK)
        : await searchDocuments(documentIds, question, topK, { diversify: mode === 'compare' });

    const relevantChunks = outcome.results;

    if (relevantChunks.length === 0) {
      return NextResponse.json({
        success: true,
        answer:
          "I couldn't find sufficient evidence for this in the uploaded documents.\n\nNo relevant passages were retrieved. Try different keywords or confirm the document pages were processed successfully.",
        sources: [],
        isGrounded: false,
        failureKind: 'no_evidence',
        retrievalMode: outcome.retrievalMode,
        documentIds,
        mode,
      });
    }

    const partial =
      records.some((r) => r.status === 'limited' || r.status === 'ready_with_warnings') ||
      records.some((r) => (r.readiness.pageCoveragePercent ?? 100) < 85);

    const coverageLabels = records
      .map((r) => coverageLabelFromReadiness(r.readiness))
      .filter(Boolean)
      .join(' ');

    const response = await generateGroundedResponse(
      question,
      relevantChunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        page: chunk.page,
        section: chunk.section,
        relevance: chunk.relevance,
        fileName: chunk.metadata.fileName,
        documentId: chunk.documentId,
      })),
      mode,
      {
        partialCoverage: partial,
        coverageLabel: coverageLabels || undefined,
      },
    );

    const sources = response.sources.map((src) => {
      const match = relevantChunks.find((chunk) => chunk.id === src.chunkId);
      return {
        ...src,
        fileName: src.fileName || match?.metadata.fileName,
        documentId: src.documentId || match?.documentId,
        page: src.page ?? match?.page,
        section: src.section ?? match?.section,
        preview: match ? `${match.content.substring(0, 220)}${match.content.length > 220 ? '…' : ''}` : undefined,
      };
    });

    const limitedBanner =
      records.some((r) => r.status === 'limited') && response.isGrounded
        ? `\n\n_Note: ${
            coverageLabels || 'Document coverage is limited — answers reflect processed pages only.'
          }_`
        : '';

    return NextResponse.json({
      success: true,
      answer: `${response.answer}${limitedBanner}`,
      sources,
      isGrounded: response.isGrounded,
      failureKind: response.failureKind,
      retrievalMode: outcome.retrievalMode,
      documentIds,
      mode,
    });
  } catch (error) {
    console.error('Chat error:', error);

    if (isPersistenceError(error)) {
      return NextResponse.json(
        { error: error.code, message: error.message, failureKind: 'persistence_error' },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        error: 'Chat failed',
        message: 'The assistant could not generate a response right now. Please try again.',
        failureKind: 'generation_error',
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Chat API - ask grounded questions about your documents',
    usage: {
      method: 'POST',
      body: {
        documentId: 'string (optional if documentIds provided)',
        documentIds: 'string[] (optional)',
        question: 'string',
        mode: 'ask | summarize | compare | extract',
      },
    },
  });
}
