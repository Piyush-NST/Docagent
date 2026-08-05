import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { MAX_UPLOAD_BYTES, SUPPORTED_UPLOAD_TYPES } from '@/lib/upload-limits';

export async function POST(request: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        {
          error: 'BLOB_STORAGE_UNAVAILABLE',
          message: 'Large-file storage is not configured. Connect a private Vercel Blob store.',
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('documents/') || pathname.includes('..')) {
          throw new Error('Invalid document upload path.');
        }

        return {
          allowedContentTypes: [...SUPPORTED_UPLOAD_TYPES],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          tokenPayload: 'docagent-document',
        };
      },
      onUploadCompleted: async () => undefined,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Blob upload authorization failed:', error);
    return NextResponse.json(
      {
        error: 'BLOB_UPLOAD_FAILED',
        message: error instanceof Error ? error.message : 'Could not authorize the large-file upload.',
      },
      { status: 400 },
    );
  }
}
