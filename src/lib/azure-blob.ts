// Original document binary storage (Azure Blob when configured, else local .data/blobs)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BlobServiceClient, ContainerClient, BlockBlobClient } from '@azure/storage-blob';
import { v4 as uuidv4 } from 'uuid';

export interface DocumentMetadata {
  documentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  blobUrl: string;
}

const hasAzureStorage = !!process.env.AZURE_STORAGE_CONNECTION_STRING;
const BLOB_ROOT = path.join(process.cwd(), '.data', 'blobs');

function getContainerClient(): ContainerClient | null {
  if (!hasAzureStorage) return null;
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'documents';
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient.getContainerClient(containerName);
}

async function ensureLocalDirs(documentId: string): Promise<string> {
  const dir = path.join(BLOB_ROOT, documentId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureContainerExists(): Promise<void> {
  if (!hasAzureStorage) {
    await fs.mkdir(BLOB_ROOT, { recursive: true });
    console.log('[Local] Using filesystem blob storage at .data/blobs');
    return;
  }

  try {
    const containerClient = getContainerClient();
    if (containerClient) {
      await containerClient.createIfNotExists({ access: 'blob' });
    }
    console.log('[Azure] Container ready');
  } catch (err) {
    console.error('Error creating container:', err);
    throw err;
  }
}

export async function uploadDocument(
  file: Buffer,
  fileName: string,
  contentType: string,
): Promise<DocumentMetadata> {
  const documentId = uuidv4();
  const blobName = `${documentId}/${fileName}`;
  const uploadedAt = new Date().toISOString();

  const metadata: DocumentMetadata = {
    documentId,
    fileName,
    fileType: contentType,
    fileSize: file.length,
    uploadedAt,
    blobUrl: hasAzureStorage ? '' : `file://${blobName}`,
  };

  if (!hasAzureStorage) {
    const dir = await ensureLocalDirs(documentId);
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, file);
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(metadata, null, 2), 'utf8');
    console.log(`[Local] Stored document binary: ${documentId}`);
    return metadata;
  }

  console.log(`[Azure] Uploading: ${fileName}`);
  const containerClient = getContainerClient()!;
  const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(file, {
    blobHTTPHeaders: { blobContentType: contentType },
    metadata: { documentId, fileName, uploadedAt },
  });

  metadata.blobUrl = blockBlobClient.url;
  console.log('[Azure] Upload complete:', documentId);
  return metadata;
}

export async function downloadDocument(
  documentId: string,
): Promise<{ data: Buffer; metadata: DocumentMetadata } | null> {
  if (!hasAzureStorage) {
    const dir = path.join(BLOB_ROOT, documentId);
    try {
      const metaRaw = await fs.readFile(path.join(dir, 'meta.json'), 'utf8');
      const metadata = JSON.parse(metaRaw) as DocumentMetadata;
      const data = await fs.readFile(path.join(dir, metadata.fileName));
      return { data, metadata };
    } catch {
      return null;
    }
  }

  const containerClient = getContainerClient()!;
  const blobs = containerClient.listBlobsFlat({ prefix: `${documentId}/` });

  for await (const blob of blobs) {
    const blockBlobClient = containerClient.getBlockBlobClient(blob.name);
    const downloadResponse = await blockBlobClient.downloadToBuffer();

    const metadata: DocumentMetadata = {
      documentId,
      fileName: blob.name.split('/').pop() || '',
      fileType: blob.properties.contentType || 'application/octet-stream',
      fileSize: blob.properties.contentLength || 0,
      uploadedAt: blob.properties.createdOn?.toISOString() || '',
      blobUrl: blockBlobClient.url,
    };

    return { data: downloadResponse, metadata };
  }

  return null;
}

export async function listDocuments(): Promise<DocumentMetadata[]> {
  if (!hasAzureStorage) {
    try {
      await fs.mkdir(BLOB_ROOT, { recursive: true });
      const ids = await fs.readdir(BLOB_ROOT);
      const docs: DocumentMetadata[] = [];
      for (const documentId of ids) {
        try {
          const metaRaw = await fs.readFile(path.join(BLOB_ROOT, documentId, 'meta.json'), 'utf8');
          docs.push(JSON.parse(metaRaw) as DocumentMetadata);
        } catch {
          // ignore incomplete folders
        }
      }
      return docs;
    } catch {
      return [];
    }
  }

  const containerClient = getContainerClient()!;
  const documents: DocumentMetadata[] = [];
  const seenIds = new Set<string>();

  for await (const blob of containerClient.listBlobsFlat()) {
    const documentId = blob.name.split('/')[0];
    if (seenIds.has(documentId)) continue;
    seenIds.add(documentId);

    documents.push({
      documentId,
      fileName: blob.name.split('/').pop() || '',
      fileType: blob.properties.contentType || 'application/octet-stream',
      fileSize: blob.properties.contentLength || 0,
      uploadedAt: blob.properties.createdOn?.toISOString() || '',
      blobUrl: '',
    });
  }

  return documents;
}

export async function deleteDocument(documentId: string): Promise<boolean> {
  if (!hasAzureStorage) {
    const dir = path.join(BLOB_ROOT, documentId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
      console.log(`[Local] Deleted document binary: ${documentId}`);
      return true;
    } catch {
      return false;
    }
  }

  const containerClient = getContainerClient()!;
  const blobs = containerClient.listBlobsFlat({ prefix: `${documentId}/` });
  let deleted = false;

  for await (const blob of blobs) {
    await containerClient.deleteBlob(blob.name);
    deleted = true;
  }

  return deleted;
}
