// upload api

import { NextRequest, NextResponse } from 'next/server';
import { uploadDocument, ensureContainerExists } from '@/lib/azure-blob';
import { processDocument } from '@/lib/document-processor';
import { storeDocumentChunks } from '@/lib/vector-store';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  REQUEST_BODY_HARD_LIMIT_BYTES,
  SUPPORTED_UPLOAD_LABEL,
  SUPPORTED_UPLOAD_TYPES,
  buildOversizedFileMessage,
  formatBytes,
} from '@/lib/upload-limits';

export async function POST(request: NextRequest) {
  try {
    await ensureContainerExists();

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > REQUEST_BODY_HARD_LIMIT_BYTES) {
      return NextResponse.json(
        {
          error: 'FILE_TOO_LARGE',
          message: `This upload is ${formatBytes(contentLength)} including form data, which is above the ${MAX_UPLOAD_LABEL} document processing limit.`,
          maxSize: MAX_UPLOAD_LABEL,
          maxBytes: MAX_UPLOAD_BYTES,
          actualSize: contentLength,
          guidance: 'Compress the file, split it into smaller documents, or upload only the pages you want to ask about.',
        },
        { status: 413 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!SUPPORTED_UPLOAD_TYPES.includes(file.type as (typeof SUPPORTED_UPLOAD_TYPES)[number])) {
      return NextResponse.json(
        { 
          error: 'File type not supported',
          message: `Please upload ${SUPPORTED_UPLOAD_LABEL} files.`,
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { 
          error: 'FILE_TOO_LARGE',
          message: buildOversizedFileMessage(file.name, file.size),
          maxSize: MAX_UPLOAD_LABEL,
          maxBytes: MAX_UPLOAD_BYTES,
          actualSize: file.size,
          actualSizeLabel: formatBytes(file.size),
          guidance: 'This project extracts and stores document text in memory during upload, so smaller files keep processing reliable.',
        },
        { status: 413 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log('Uploading to blob storage...');
    const metadata = await uploadDocument(buffer, file.name, file.type);

    console.log('Processing document...');
    const processedDoc = await processDocument(
      metadata.documentId,
      buffer,
      file.name,
      file.type
    );

    console.log('Generating embeddings...');
    await storeDocumentChunks(metadata.documentId, processedDoc.chunks);

    console.log('Upload complete!');

    return NextResponse.json({
      success: true,
      documentId: metadata.documentId,
      fileName: metadata.fileName,
      fileType: metadata.fileType,
      fileSize: metadata.fileSize,
      uploadedAt: metadata.uploadedAt,
      processing: {
        totalChunks: processedDoc.totalChunks,
        pages: processedDoc.pages,
        textLength: processedDoc.rawText.length,
      },
      message: 'Document uploaded successfully!',
    });

  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { 
        error: 'Upload failed',
        message: error instanceof Error ? error.message : 'Something went wrong'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Upload API',
    supportedTypes: ['PDF', 'DOCX', 'PNG', 'JPG'],
    maxSize: MAX_UPLOAD_LABEL,
  });
}
