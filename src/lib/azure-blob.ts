// blob storage for documents

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

// fallback to in-memory if no azure
const localStorage: Map<string, { data: Buffer; metadata: DocumentMetadata }> = new Map();

function getContainerClient(): ContainerClient | null {
  if (!hasAzureStorage) {
    return null;
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'documents';

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient.getContainerClient(containerName);
}

export async function ensureContainerExists(): Promise<void> {
  if (!hasAzureStorage) {
    console.log('[Local] Using in-memory storage');
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
  contentType: string
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
    blobUrl: hasAzureStorage ? '' : `local://${blobName}`,
  };

  if (!hasAzureStorage) {
    localStorage.set(documentId, { data: file, metadata });
    console.log(`[Local] Stored document: ${documentId}`);
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

export async function downloadDocument(documentId: string): Promise<{ data: Buffer; metadata: DocumentMetadata } | null> {
  if (!hasAzureStorage) {
    const stored = localStorage.get(documentId);
    if (stored) {
      console.log(`[Local] Retrieved document: ${documentId}`);
      return stored;
    }
    return null;
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
    return Array.from(localStorage.values()).map(item => item.metadata);
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
    const deleted = localStorage.delete(documentId);
    console.log(`[Local] Deleted document: ${documentId}`);
    return deleted;
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
