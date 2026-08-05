import { del, get } from '@vercel/blob';

export type StoredBlobAccess = 'private' | 'public';

export function isVercelBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

export async function downloadVercelBlob(
  url: string,
  access: StoredBlobAccess = 'private',
): Promise<{ data: Buffer; size: number; contentType: string } | null> {
  if (!isVercelBlobUrl(url)) return null;
  const result = await get(url, { access, useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;

  const data = Buffer.from(await new Response(result.stream).arrayBuffer());
  return {
    data,
    size: result.blob.size,
    contentType: result.blob.contentType || 'application/octet-stream',
  };
}

export async function deleteVercelBlob(url: string): Promise<boolean> {
  if (!isVercelBlobUrl(url)) return false;
  await del(url);
  return true;
}
