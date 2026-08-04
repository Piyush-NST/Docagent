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
import { classifyAnswerIntent, retrievalQueryForIntent, topKForIntent } from '@/lib/answer-intent';
import { INDEX_VERSION, isCurrentIndexVersion } from '@/lib/config/indexing';

interface ChatRequest {
  documentId?: string;
  documentIds?: string[];
  question: string;
  mode?: ChatMode;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function normalizeMode(mode: unknown): ChatMode {
  if (mode === 'summarize' || mode === 'compare' || mode === 'extract' || mode === 'ask') return mode;
  return 'ask';
}

function normalizeHistory(history: ChatRequest['history']) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
    .slice(-6)
    .map((turn) => ({ role: turn.role, content: turn.content.trim().slice(0, 1600) }))
    .filter((turn) => turn.content);
}

function comparisonRetrievalQuery(question: string, history: ReturnType<typeof normalizeHistory>): string {
  const priorUserQuestion = [...history].reverse().find((turn) => turn.role === 'user')?.content;
  const context = priorUserQuestion ? `${priorUserQuestion} ${question}` : question;
  return `${context} key facts purpose scope similarities differences dates metrics outcomes experience skills risks`;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const mode = normalizeMode(body.mode);
    const question = body.question?.trim() || '';
    const history = normalizeHistory(body.history);
    const answerIntent = classifyAnswerIntent(question);

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

    if (process.env.NODE_ENV === 'development') {
      console.log(`Question (${mode}) for docs [${documentIds.join(', ')}]: "${question}"`);
    }

    const records = [];
    for (const documentId of documentIds) {
      const record = await getDocumentRecord(documentId);
      const chunks = await getDocumentChunks(documentId);

      if (!record || !isCurrentIndexVersion(record.indexVersion)) {
        return NextResponse.json(
          {
            error: 'INDEX_OUTDATED',
            message: `This document uses an older index. Delete it and upload it again to create index version ${INDEX_VERSION}.`,
            documentId,
            storedIndexVersion: record?.indexVersion ?? null,
            currentIndexVersion: INDEX_VERSION,
          },
          { status: 409 },
        );
      }

      if (!isDocumentQueryable(record.status) || chunks.length === 0) {
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
      records.push(record);
    }

    const topK =
      mode === 'summarize'
        ? RETRIEVAL_CONFIG.summarizeTopK
        : mode === 'compare'
          ? RETRIEVAL_CONFIG.compareTopK
          : documentIds.length > 1
            ? RETRIEVAL_CONFIG.multiDocTopK
            : topKForIntent(answerIntent);

    const retrievalQuestion = mode === 'compare'
      ? comparisonRetrievalQuery(question, history)
      : retrievalQueryForIntent(question, answerIntent);
    const needsBroadDocumentContext =
      mode === 'summarize' || answerIntent === 'overview' || answerIntent === 'summary' || answerIntent === 'detail';
    const outcome =
      documentIds.length === 1
        ? await searchDocument(documentIds[0], retrievalQuestion, topK, {
            includeAllWhenSmall: needsBroadDocumentContext,
          })
        : await searchDocuments(documentIds, retrievalQuestion, topK, { diversify: mode === 'compare' });

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
        conversationHistory: history,
        answerIntent,
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

    const coverageNotice =
      records.some((r) => r.status === 'limited') && response.isGrounded
        ? (
            coverageLabels || 'Document coverage is limited — answers reflect processed pages only.'
          )
        : undefined;

    const citations = sources.map((source) => ({
      chunkId: source.chunkId,
      page: source.page,
      section: source.section,
      relevance: source.relevance,
      fileName: source.fileName,
      documentId: source.documentId,
    }));
    const developmentDebug = process.env.NODE_ENV === 'development'
      ? {
          question,
          intent: answerIntent,
          retrievalMode: outcome.retrievalMode,
          retrievalTopK: topK,
          retrievedChunkCount: relevantChunks.length,
          retrievedChunkIds: relevantChunks.map((chunk) => chunk.id),
          retrievedChunkLengths: relevantChunks.map((chunk) => chunk.content.length),
          totalContextCharacters: relevantChunks.reduce((total, chunk) => total + chunk.content.length, 0),
          embeddingAvailable: outcome.embeddingAvailable,
          answerProvider: response.debug?.provider,
          answerModel: response.debug?.model,
          generator: response.debug?.answerGenerator,
          answerGenerator: response.debug?.answerGenerator,
          fallbackUsed: response.debug?.fallbackUsed,
          model: response.debug?.model,
          promptVersion: response.debug?.promptVersion,
          structuredOutputValid: response.debug?.structuredOutputValid,
          modelFailureReason: response.debug?.modelFailureReason,
          modelStatus: response.debug?.modelStatus,
          rawModelOutput: response.debug?.rawModelOutput?.slice(0, 4000),
          modelError: response.debug?.modelError,
          finishReason: response.debug?.finishReason,
          structuredFailureReason: response.debug?.structuredFailureReason,
          retryUsed: response.debug?.retryUsed,
          retryType: response.debug?.retryType,
          normalizationApplied: response.debug?.normalizationApplied,
          outputTokensBudget: response.debug?.outputTokensBudget,
          finalApiAnswer: response.answer,
        }
      : undefined;

    if (developmentDebug) console.info('[DocAgent Chat Debug]', developmentDebug);

    return NextResponse.json({
      success: true,
      answer: response.answer,
      citations,
      evidence: sources,
      grounded: response.isGrounded,
      structuredAnswer: response.structuredAnswer,
      coverageNotice,
      generationNotice: response.generationNotice,
      sources,
      isGrounded: response.isGrounded,
      failureKind: response.failureKind,
      retrievalMode: outcome.retrievalMode,
      documentIds,
      mode,
      answerIntent,
      debug: developmentDebug,
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
        history: 'optional recent user/assistant turns',
      },
    },
  });
}
