import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  SUPPORTED_UPLOAD_LABEL,
  SUPPORTED_UPLOAD_TYPES,
  formatBytes,
} from '@/lib/upload-limits';

export type FileValidationError = {
  code:
    | 'EMPTY_FILE'
    | 'UNSUPPORTED_TYPE'
    | 'FILE_TOO_LARGE'
    | 'INVALID_NAME';
  message: string;
};

export function validateUploadFile(file: {
  name: string;
  type: string;
  size: number;
}): FileValidationError | null {
  if (!file.name?.trim()) {
    return { code: 'INVALID_NAME', message: 'File name is missing or invalid.' };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { code: 'EMPTY_FILE', message: 'File appears to be empty.' };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      code: 'FILE_TOO_LARGE',
      message: `This file is ${formatBytes(file.size)}. This workspace supports files up to ${MAX_UPLOAD_LABEL}.`,
    };
  }

  const lower = file.name.toLowerCase();
  const extensionOk =
    lower.endsWith('.pdf') ||
    lower.endsWith('.docx') ||
    lower.endsWith('.doc') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg');

  const mimeOk = SUPPORTED_UPLOAD_TYPES.includes(file.type as (typeof SUPPORTED_UPLOAD_TYPES)[number]);

  // Some browsers omit MIME for certain uploads — allow known extensions.
  if (!mimeOk && !extensionOk) {
    return {
      code: 'UNSUPPORTED_TYPE',
      message: `Unsupported file type. Please upload ${SUPPORTED_UPLOAD_LABEL} files.`,
    };
  }

  return null;
}

export function isLikelyPasswordProtectedError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('password') ||
    lower.includes('encrypted') ||
    lower.includes('permission denied') ||
    lower.includes('need a password')
  );
}
