import type { AutomationRecord, AutomationRecordRepository } from "../automation/AutomationWorker.js";
import { JsonFileDocumentStore } from "./DocumentStore.js";

const COLLECTION = "automation_records";
/** Bounded history: enough for ops/debugging, small enough to stay cheap. */
const MAX_RECORDS = 5_000;

interface AutomationRecordDocument {
  records: AutomationRecord[];
}

/**
 * Durable automation record store (Phase 6, §9 `jobs`/results history).
 * Replaces the append-only JSONL file: records survive restarts, stay bounded,
 * and can be listed for the ops/API surfaces.
 */
export class DurableAutomationRecordRepository implements AutomationRecordRepository {
  constructor(private readonly store: JsonFileDocumentStore) {
    store.register(COLLECTION, "app_data", "Automation run results (trigger/distribute/retry/claim attempts)");
  }

  async record(value: AutomationRecord): Promise<void> {
    await this.store.update<AutomationRecordDocument>(COLLECTION, { records: [] }, (document) => {
      document.records.push(value);
      if (document.records.length > MAX_RECORDS) {
        document.records.splice(0, document.records.length - MAX_RECORDS);
      }
      return document;
    });
  }

  /** Newest-first history (for ops/admin endpoints). */
  async recent(limit = 100): Promise<AutomationRecord[]> {
    const document = await this.store.load<AutomationRecordDocument>(COLLECTION, { records: [] });
    return document.records.slice(-limit).reverse();
  }

  async count(): Promise<number> {
    const document = await this.store.load<AutomationRecordDocument>(COLLECTION, { records: [] });
    return document.records.length;
  }
}
