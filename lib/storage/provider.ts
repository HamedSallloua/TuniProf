// Where uploaded files (teacher photos) are kept. The site only talks to this interface:
// a local folder in development, an S3-compatible bucket in production (added at M12).

export interface StorageProvider {
  /** Stores `data` under `key` (e.g. "photos/<uuid>.jpg"), replacing anything there. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;

  /** The stored file, or null when the key does not exist. */
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;

  /** Removes the file. Silent when it does not exist. */
  delete(key: string): Promise<void>;

  /** Address the browser uses to show the file. */
  publicUrl(key: string): string;
}

/** Keys are plain relative paths: lowercase letters, digits, dashes, dots, one or more folders. */
const KEY_PATTERN = /^[a-z0-9]+(?:\/[a-z0-9][a-z0-9._-]*)+$/;

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !key.includes('..');
}
