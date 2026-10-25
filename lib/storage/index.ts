import path from 'node:path';
import { createLocalStorage } from './local';
import type { StorageProvider } from './provider';

let instance: StorageProvider | undefined;

/**
 * The storage in use. Today: a local folder (./uploads, or STORAGE_LOCAL_DIR).
 * Production uses an S3-compatible bucket, added at M12; nothing else changes then.
 */
export function getStorage(): StorageProvider {
  instance ??= createLocalStorage(
    process.env.STORAGE_LOCAL_DIR ?? path.join(process.cwd(), 'uploads'),
  );
  return instance;
}

export type { StorageProvider } from './provider';
