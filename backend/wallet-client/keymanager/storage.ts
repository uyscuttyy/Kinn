/**
 * Pluggable at-rest storage for the KeyManager.
 *
 * Only ciphertext + public metadata is ever written here. The interface is
 * intentionally tiny so it can be backed by localStorage (browser),
 * IndexedDB, a test memory store, or a future encrypted file store.
 */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys beginning with the given prefix. */
  keys(prefix: string): Promise<string[]>;
}

/** In-memory store. Used by tests and as a non-persistent fallback. */
export class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

/** localStorage-backed store for the browser. Throws if unavailable. */
export class BrowserLocalStorage implements KeyValueStorage {
  constructor(private readonly localStorage: Storage) {}

  async get(key: string): Promise<string | null> {
    return this.localStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.localStorage.setItem(key, value);
  }

  async delete(key: string): Promise<void> {
    this.localStorage.removeItem(key);
  }

  async keys(prefix: string): Promise<string[]> {
    const found: string[] = [];
    for (let i = 0; i < this.localStorage.length; i += 1) {
      const k = this.localStorage.key(i);
      if (k && k.startsWith(prefix)) found.push(k);
    }
    return found;
  }
}

/**
 * Returns a BrowserLocalStorage when running in a browser with localStorage
 * available, otherwise a MemoryStorage (Node/tests). Never throws.
 */
export function createDefaultStorage(): KeyValueStorage {
  try {
    if (typeof localStorage !== "undefined") return new BrowserLocalStorage(localStorage);
  } catch {
    // localStorage can throw on access (e.g. disabled cookies) — fall through.
  }
  return new MemoryStorage();
}
