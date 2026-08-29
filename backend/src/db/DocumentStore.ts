/**
 * Kinn durable store (Phase 6 milestone 6.2, ARCHITECTURE.md §9).
 *
 * The blockchain is the source of truth for ownership, balances, beneficiaries,
 * check-in state, and inheritance status. This store only holds **derived,
 * rebuildable** data: automation records, reminders, indexing cursors, and
 * (future) transaction/event caches.
 *
 * Every collection is registered with a `source` flag so the boundary is
 * explicit in the data layer itself:
 *  - "chain_mirror" — a cached projection of on-chain state; always refreshed
 *    from the chain before being used in any authoritative decision.
 *  - "app_data"      — service-generated data that exists only off-chain.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type CollectionSource = "chain_mirror" | "app_data";

export interface CollectionDescriptor {
  name: string;
  source: CollectionSource;
  description: string;
}

export interface DocumentStore {
  load<T>(collection: string, fallback: T): Promise<T>;
  save<T>(collection: string, value: T): Promise<void>;
  /** Serialized read-modify-write: no interleaved update can lose changes. */
  update<T>(collection: string, fallback: T, change: (value: T) => T): Promise<void>;
}

export class JsonFileDocumentStore implements DocumentStore {
  private readonly descriptors = new Map<string, CollectionDescriptor>();
  /** Per-collection write queues so concurrent read-modify-write cycles serialize. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly directory: string) {}

  /** Register a collection and its source-of-truth boundary. Idempotent. */
  register(name: string, source: CollectionSource, description: string): void {
    const existing = this.descriptors.get(name);
    if (existing) {
      if (existing.source !== source || existing.description !== description) {
        throw new Error(`Collection ${name} is already registered with a different descriptor`);
      }
      return;
    }
    this.descriptors.set(name, { name, source, description });
  }

  /** Registered collections with their source flags (for ops/health surfaces). */
  manifest(): CollectionDescriptor[] {
    return [...this.descriptors.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async load<T>(collection: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(this.path(collection), "utf8");
      return JSON.parse(raw, documentReviver) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      // A corrupt file must never crash the service: quarantine it and start
      // from the fallback (all stored data is derived and rebuildable).
      if (error instanceof SyntaxError) {
        await this.quarantine(collection);
        return fallback;
      }
      throw error;
    }
  }

  async save<T>(collection: string, value: T): Promise<void> {
    return this.enqueue(collection, async () => {
      await this.writeAtomically(collection, value);
    });
  }

  async update<T>(collection: string, fallback: T, change: (value: T) => T): Promise<void> {
    return this.enqueue(collection, async () => {
      const current = await this.load(collection, fallback);
      await this.writeAtomically(collection, change(current));
    });
  }

  /** Serialize the whole cycle per collection: without this, two interleaved
   *  read-modify-write updates can drop one another's changes. */
  private async enqueue<T>(collection: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(collection) ?? Promise.resolve();
    const next = previous.then(operation);
    this.queues.set(
      collection,
      next.catch(() => undefined)
    );
    return next;
  }

  private async writeAtomically<T>(collection: string, value: T): Promise<void> {
    const path = this.path(collection);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, documentReplacer, 2), { mode: 0o600 });
    await rename(temporary, path);
  }

  private async quarantine(collection: string): Promise<void> {
    const path = this.path(collection);
    try {
      await rename(path, `${path}.corrupt-${Date.now()}`);
    } catch {
      // Nothing to quarantine if the file vanished between read and rename.
    }
  }

  private path(collection: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(collection)) {
      throw new Error(`Invalid collection name: ${collection}`);
    }
    return join(this.directory, `${collection}.json`);
  }
}

/** BigInt-safe JSON encoding: `123n` round-trips instead of throwing. */
function documentReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { __bigint: value.toString() };
  return value;
}

function documentReviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    "__bigint" in (value as Record<string, unknown>)
  ) {
    const raw = (value as { __bigint: unknown }).__bigint;
    if (typeof raw === "string" && /^-?\d+$/.test(raw)) return BigInt(raw);
  }
  return value;
}
