import { FileStore } from './file-store';
import { MemoryStore } from './memory-store';
import { PostgresStore } from './postgres-store';
import type { DocAgentStore, StorageBackend } from './types';
import { PersistenceUnavailableError } from './types';

const globalForStore = globalThis as typeof globalThis & {
  __docAgentStore?: DocAgentStore;
};

function resolveBackend(): StorageBackend {
  const forced = (process.env.DOCAGENT_STORAGE || '').toLowerCase();
  if (forced === 'postgres' || forced === 'file' || forced === 'memory') {
    return forced;
  }

  if (process.env.DATABASE_URL) return 'postgres';

  // Vercel serverless has no durable local disk — require Postgres.
  if (process.env.VERCEL === '1') {
    throw new PersistenceUnavailableError(
      'Persistent storage is required on Vercel. Set DATABASE_URL (Postgres/Neon).',
    );
  }

  // Local/dev (and non-Vercel hosts): durable JSON files under .data/
  return 'file';
}

export function getStorageBackend(): StorageBackend {
  try {
    return getStore().backend;
  } catch {
    return resolveBackend();
  }
}

export function getStore(): DocAgentStore {
  if (globalForStore.__docAgentStore) return globalForStore.__docAgentStore;

  const backend = resolveBackend();
  let store: DocAgentStore;

  if (backend === 'postgres') {
    store = new PostgresStore();
  } else if (backend === 'memory') {
    store = new MemoryStore();
  } else {
    store = new FileStore();
  }

  console.log(`[Store] Using ${store.backend} document/chunk persistence`);
  globalForStore.__docAgentStore = store;
  return store;
}

/** Test-only: reset singleton */
export function resetStoreForTests(store?: DocAgentStore): void {
  globalForStore.__docAgentStore = store;
}

export function isPersistenceError(error: unknown): error is PersistenceUnavailableError {
  return error instanceof PersistenceUnavailableError;
}

export { PersistenceUnavailableError };
