export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const DIRECT_UPLOAD_THRESHOLD_BYTES = 4 * 1024 * 1024;
export const REQUEST_BODY_HARD_LIMIT_BYTES = DIRECT_UPLOAD_THRESHOLD_BYTES + 512 * 1024;
export const MAX_UPLOAD_LABEL = '20MB';

export const SUPPORTED_UPLOAD_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/png',
  'image/jpeg',
  'image/jpg',
] as const;

export const SUPPORTED_UPLOAD_LABEL = 'PDF, DOCX, PNG, or JPG';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)}${units[unitIndex]}`;
}

export function buildOversizedFileMessage(_fileName: string, fileSize: number): string {
  return `This file is ${formatBytes(fileSize)}. This workspace supports files up to ${MAX_UPLOAD_LABEL}. Try compressing the PDF, splitting it, or uploading selected pages.`;
}
