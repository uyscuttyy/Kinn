import type { JsonFileDocumentStore } from "./DocumentStore.js";

const COLLECTION = "submission_ledger";

export type SubmissionState = "pending" | "confirmed" | "reverted";

export interface LedgerEntry {
  /** Logical action key: `${candidateId}:${kind}:${asset}:${beneficiary}`. */
  readonly key: string;
  readonly state: SubmissionState;
  readonly transactionHash?: string;
  readonly updatedAt: number;
  readonly detail?: string;
}

interface LedgerDocument {
  entries: Record<string, LedgerEntry>;
}

/**
 * What the gate should do with a logical action before any submission.
 *  - "submit": no tracked state (or a previously reverted attempt) — submit.
 *  - "wait":   a transaction is already pending for this action; resolve its
 *              receipt instead of submitting a second transaction.
 *  - "skip":   this action already confirmed successfully on-chain.
 */
export type GateDecision = "submit" | "wait" | "skip";

/**
 * Durable double-submit ledger (Phase 9, ARCHITECTURE §14:
 * "never double-submit is a tracked invariant").
 *
 * Keyed by logical action (candidate + kind + asset + beneficiary), not by
 * transaction hash, so a crash between submit and receipt-resolution is
 * recovered on the next pass: the pending hash is waited on rather than
 * re-submitted. State is app_data (keeper bookkeeping); the contract remains
 * the final authority even if this ledger is lost.
 */
export class DurableSubmissionLedger {
  constructor(private readonly store: JsonFileDocumentStore) {
    store.register(COLLECTION, "app_data", "Keeper double-submit ledger (logical action -> pending/confirmed/reverted)");
  }

  async decide(key: string): Promise<GateDecision> {
    const entry = (await this.read()).entries[key];
    if (!entry) return "submit";
    if (entry.state === "pending") return "wait";
    if (entry.state === "confirmed") return "skip";
    return "submit"; // reverted attempts may safely be retried
  }

  /** The hash of a pending transaction for this action (crash recovery). */
  async pendingHash(key: string): Promise<string | undefined> {
    const entry = (await this.read()).entries[key];
    return entry?.state === "pending" ? entry.transactionHash : undefined;
  }

  async markPending(key: string, transactionHash: string, at: number): Promise<void> {
    await this.write(key, { key, state: "pending", transactionHash, updatedAt: at });
  }

  async markConfirmed(key: string, success: boolean, at: number, detail?: string): Promise<void> {
    await this.write(key, { key, state: success ? "confirmed" : "reverted", updatedAt: at, detail });
  }

  async entry(key: string): Promise<LedgerEntry | undefined> {
    return (await this.read()).entries[key];
  }

  private async read(): Promise<LedgerDocument> {
    return this.store.load<LedgerDocument>(COLLECTION, { entries: {} });
  }

  private async write(key: string, entry: LedgerEntry): Promise<void> {
    await this.store.update<LedgerDocument>(COLLECTION, { entries: {} }, (document) => {
      document.entries[key] = entry;
      return document;
    });
  }
}
