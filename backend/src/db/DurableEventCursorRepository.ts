import type { EventCursorRepository } from "../blockchain/KinnEventMonitor.js";
import { JsonFileDocumentStore } from "./DocumentStore.js";

const COLLECTION = "indexing_cursor";

interface CursorDocument {
  blockNumber: number;
}

/**
 * Durable indexing cursor (Phase 6, §10/§9 `indexing_cursor`).
 * The cursor survives restarts so the monitor resumes where it stopped instead
 * of re-scanning or skipping blocks. One cursor per store key (e.g. per network).
 */
export class DurableEventCursorRepository implements EventCursorRepository {
  constructor(
    private readonly store: JsonFileDocumentStore,
    private readonly key = "default"
  ) {
    store.register(this.collection, "app_data", "Last indexed block per network (restart-safe)");
  }

  async get(): Promise<number> {
    const document = await this.store.load<CursorDocument>(this.collection, { blockNumber: 0 });
    return document.blockNumber;
  }

  async set(blockNumber: number): Promise<void> {
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
      throw new Error(`Invalid block number: ${blockNumber}`);
    }
    await this.store.save(this.collection, { blockNumber });
  }

  private get collection(): string {
    // Collection names are validated by the store; suffix with the network key.
    return `${COLLECTION}_${this.key}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
}
