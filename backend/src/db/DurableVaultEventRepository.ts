import type { JsonFileDocumentStore } from "./DocumentStore.js";

const COLLECTION = "vault_events";
/** Bounded history; trim oldest beyond this. */
const MAX_EVENTS = 50_000;

/**
 * One parsed on-chain event (factory or vault instance). BigInts are stored as
 * decimal strings so the record is JSON-safe end to end.
 */
export interface IndexedVaultEvent {
  /** Dedupe key: `${transactionHash}:${logIndex}` (ARCHITECTURE §10). */
  readonly key: string;
  readonly name: string;
  /** Emitting contract (factory or vault instance address). */
  readonly address: string;
  readonly blockNumber: number;
  readonly transactionHash: string;
  readonly logIndex: number;
  /** Decoded event arguments (bigint values serialized as decimal strings). */
  readonly values: Record<string, string | number | boolean>;
  /** Indexed `owner` argument when the event carries one (query dimension). */
  readonly owner?: string;
}

interface VaultEventDocument {
  events: IndexedVaultEvent[];
  /** Dedupe index; rebuilt lazily if missing. */
  keys?: string[];
}

/**
 * Durable parsed-event index (Phase 8, §9 `vault_events` / §10).
 * Events are deduped by (txHash, logIndex) so cursor drift or re-scans can
 * never double-insert. Chain-mirror data: always rebuildable from the chain.
 */
export class DurableVaultEventRepository {
  constructor(private readonly store: JsonFileDocumentStore) {
    store.register(COLLECTION, "chain_mirror", "Parsed factory/vault event index (deduped by txHash+logIndex)");
  }

  /** Insert-only: skips events whose dedupe key already exists. Returns the count added. */
  async addAll(incoming: readonly IndexedVaultEvent[]): Promise<number> {
    if (incoming.length === 0) return 0;
    let added = 0;
    await this.store.update<VaultEventDocument>(COLLECTION, { events: [] }, (document) => {
      const known = new Set(document.keys ?? document.events.map((event) => event.key));
      for (const event of incoming) {
        if (known.has(event.key)) continue;
        known.add(event.key);
        document.events.push(event);
        added += 1;
      }
      if (document.events.length > MAX_EVENTS) {
        document.events.splice(0, document.events.length - MAX_EVENTS);
      }
      document.keys = [...known];
      return document;
    });
    return added;
  }

  async has(key: string): Promise<boolean> {
    return (await this.read()).keys?.includes(key) ?? (await this.read()).events.some((event) => event.key === key);
  }

  async count(): Promise<number> {
    return (await this.read()).events.length;
  }

  /** Newest-first events for an owner (any event carrying that indexed owner). */
  async byOwner(owner: string, limit = 100, cursor?: string): Promise<IndexedVaultEvent[]> {
    const normalized = owner.toLowerCase();
    const filtered = (await this.read()).events.filter((event) => event.owner?.toLowerCase() === normalized);
    return paginateNewestFirst(filtered, limit, cursor);
  }

  /** Newest-first events for one vault instance. */
  async byVault(vault: string, limit = 100, cursor?: string): Promise<IndexedVaultEvent[]> {
    const normalized = vault.toLowerCase();
    const filtered = (await this.read()).events.filter((event) => event.address.toLowerCase() === normalized);
    return paginateNewestFirst(filtered, limit, cursor);
  }

  async recent(limit = 100): Promise<IndexedVaultEvent[]> {
    const events = (await this.read()).events;
    return events.slice(-limit).reverse();
  }

  private async read(): Promise<VaultEventDocument> {
    const document = await this.store.load<VaultEventDocument>(COLLECTION, { events: [] });
    if (!document.keys) {
      document.keys = [...new Set(document.events.map((event) => event.key))];
      await this.store.save(COLLECTION, document);
    }
    return document;
  }
}

function paginateNewestFirst(events: IndexedVaultEvent[], limit: number, cursor?: string): IndexedVaultEvent[] {
  const newestFirst = [...events].reverse();
  const startIndex = cursor ? newestFirst.findIndex((event) => event.key === cursor) + 1 : 0;
  return newestFirst.slice(Math.max(startIndex, 0), Math.max(startIndex, 0) + limit);
}
