import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidStorageKey, type StorageProvider } from './provider';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

/** Keeps files in a folder on this machine (development). The folder is git-ignored. */
export function createLocalStorage(rootDir: string): StorageProvider {
  const root = path.resolve(rootDir);

  // The key is checked twice: by its shape, and by where the path really lands.
  function pathFor(key: string): string {
    if (!isValidStorageKey(key)) throw new Error(`Invalid storage key: ${key}`);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep))
      throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  return {
    async put(key, data) {
      const full = pathFor(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data);
    },

    async get(key) {
      try {
        const data = await readFile(pathFor(key));
        const contentType =
          CONTENT_TYPES[path.extname(key)] ?? 'application/octet-stream';
        return { data, contentType };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },

    async delete(key) {
      await rm(pathFor(key), { force: true });
    },

    publicUrl: (key) => `/media/${key}`,
  };
}
