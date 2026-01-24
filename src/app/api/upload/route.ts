// upload api

import { NextRequest, NextResponse } from 'next/server';
import { uploadDocument, ensureContainerExists } from '@/lib/azure-blob';
import { processDocument } from '@/lib/document-processor';
import { storeDocumentChunks } from '@/lib/vector-store';

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/png',
  'image/jpeg',
  'image/jpg',
];

const MAX_SIZE = 10 * 1024 * 1024; // 10mb

export async function POST(request: NextRequest) {
  try {
    await ensureContainerExists();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { 
          error: 'File type not supported',
          message: 'Please upload PDF, DOCX, PNG, or JPG files',
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { 
          error: 'File too big',
          message: 'Max file size is 10MB',
        },
        { status: 400 }
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
    maxSize: '10MB',
  });
}
