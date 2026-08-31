import type { PreparedTransaction, VaultStatus } from "../types.js";

export interface AutomationCandidate {
  id: string;
  deploymentKey: string;
  owner: string;
}

export interface PendingDistribution {
  token: string;
  beneficiary: string;
  amount: bigint;
  nextRetryAt: bigint;
}

export interface AutomationVaultState {
  status: VaultStatus;
  processedTokens: Record<string, boolean>;
  pendingDistributions: PendingDistribution[];
}

export interface AutomationCandidateRepository {
  listCandidates(): Promise<AutomationCandidate[]>;
}

export interface AutomationGateway {
  readState(candidate: AutomationCandidate): Promise<AutomationVaultState>;
  prepareTrigger(candidate: AutomationCandidate): Promise<PreparedTransaction>;
  prepareTokenDistribution(candidate: AutomationCandidate, token: string): Promise<PreparedTransaction>;
  prepareRetry(candidate: AutomationCandidate, pending: PendingDistribution): Promise<PreparedTransaction>;
  prepareReserveClaim(candidate: AutomationCandidate): Promise<PreparedTransaction>;
}

export interface RelayerReceipt {
  transactionHash: string;
  blockNumber: number;
  success: boolean;
}

export interface RelayerSubmitter {
  submit(deploymentKey: string, transaction: PreparedTransaction): Promise<string>;
  wait(deploymentKey: string, transactionHash: string): Promise<RelayerReceipt>;
}

export interface AutomationRecord {
  candidateId: string;
  kind: "trigger" | "distribute" | "retry" | "claim";
  transactionHash?: string;
  success: boolean;
  detail: string;
  recordedAt: number;
}

export interface AutomationRecordRepository {
  record(value: AutomationRecord): Promise<void>;
}

export interface AutomationNotifier {
  notify(candidate: AutomationCandidate, record: AutomationRecord): Promise<void>;
}

/**
 * Double-submit guard (Phase 9, §14). Keyed by logical action; see
 * DurableSubmissionLedger for the durable implementation.
 */
export interface SubmissionGate {
  decide(key: string): Promise<"submit" | "wait" | "skip">;
  pendingHash(key: string): Promise<string | undefined>;
  markPending(key: string, transactionHash: string, at: number): Promise<void>;
  markConfirmed(key: string, success: boolean, at: number, detail?: string): Promise<void>;
}

export class InMemorySubmissionGate implements SubmissionGate {
  private readonly entries = new Map<string, { state: "pending" | "confirmed" | "reverted"; hash?: string }>();
  async decide(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return "submit";
    if (entry.state === "pending") return "wait";
    if (entry.state === "confirmed") return "skip";
    return "submit";
  }
  async pendingHash(key: string) { return this.entries.get(key)?.state === "pending" ? this.entries.get(key)!.hash : undefined; }
  async markPending(key: string, transactionHash: string) { this.entries.set(key, { state: "pending", hash: transactionHash }); }
  async markConfirmed(key: string, success: boolean) { this.entries.set(key, { state: success ? "confirmed" : "reverted" }); }
}

export class InMemoryAutomationCandidateRepository implements AutomationCandidateRepository {
  constructor(private readonly values: AutomationCandidate[]) {}
  async listCandidates() { return this.values; }
}

export class InMemoryAutomationRecordRepository implements AutomationRecordRepository {
  readonly values: AutomationRecord[] = [];
  async record(value: AutomationRecord) { this.values.push(value); }
}

export class AutomationWorker {
  private runInProgress = false;

  constructor(
    private readonly candidates: AutomationCandidateRepository,
    private readonly gateway: AutomationGateway,
    private readonly relayer: RelayerSubmitter,
    private readonly records: AutomationRecordRepository,
    private readonly notifier: AutomationNotifier,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
    /** Double-submit guard (Phase 9); in-memory by default, durable in production. */
    private readonly gate: SubmissionGate = new InMemorySubmissionGate()
  ) {}

  /**
   * One keeper pass. Ingestion-locked (API.md /automation/run): concurrent
   * invocations are refused instead of racing on the same candidates.
   */
  async runOnce(): Promise<{ checked: number; submitted: number; failed: number; skipped?: true }> {
    if (this.runInProgress) return { checked: 0, submitted: 0, failed: 0, skipped: true };
    this.runInProgress = true;
    try {
      return await this.pass();
    } finally {
      this.runInProgress = false;
    }
  }

  private async pass(): Promise<{ checked: number; submitted: number; failed: number }> {
    const candidates = await this.candidates.listCandidates();
    let submitted = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        let state = await this.gateway.readState(candidate);
        if (state.status.vault.active && !state.status.vault.inheritanceTriggered && state.status.inheritanceEligible) {
          const attempt = await this.submit(
            candidate, "trigger", "inheritance trigger",
            `${candidate.id}:trigger`,
            () => this.gateway.prepareTrigger(candidate)
          );
          if (attempt.outcome === "submitted") submitted += 1;
          if (!attempt.success) { failed += 1; continue; }
          state = await this.gateway.readState(candidate);
        }

        if (!state.status.vault.inheritanceTriggered) continue;
        for (const token of state.status.tokens) {
          if (state.processedTokens[token]) continue;
          const attempt = await this.submit(
            candidate, "distribute", `token distribution ${token}`,
            `${candidate.id}:distribute:${token.toLowerCase()}`,
            () => this.gateway.prepareTokenDistribution(candidate, token)
          );
          if (attempt.outcome === "submitted") submitted += 1;
          if (!attempt.success) failed += 1;
        }

        state = await this.gateway.readState(candidate);
        for (const pending of state.pendingDistributions) {
          if (pending.amount === 0n || BigInt(this.now()) < pending.nextRetryAt) continue;
          const attempt = await this.submit(
            candidate, "retry", `retry ${pending.token} to ${pending.beneficiary}`,
            `${candidate.id}:retry:${pending.token.toLowerCase()}:${pending.beneficiary.toLowerCase()}`,
            () => this.gateway.prepareRetry(candidate, pending)
          );
          if (attempt.outcome === "submitted") submitted += 1;
          if (!attempt.success) failed += 1;
        }

        state = await this.gateway.readState(candidate);
        const allTokensProcessed = state.status.tokens.every((token) => state.processedTokens[token]);
        if (
          state.status.vault.inheritanceTriggered &&
          allTokensProcessed &&
          state.pendingDistributions.length === 0 &&
          state.status.vault.automationReserve > 0n
        ) {
          const attempt = await this.submit(
            candidate, "claim", "completed automation reserve claim",
            `${candidate.id}:claim`,
            () => this.gateway.prepareReserveClaim(candidate)
          );
          if (attempt.outcome === "submitted") submitted += 1;
          if (!attempt.success) failed += 1;
        }
      } catch (error) {
        failed += 1;
        await this.saveAndNotify(candidate, {
          candidateId: candidate.id,
          kind: "trigger",
          success: false,
          detail: error instanceof Error ? error.message : "Automation candidate failed",
          recordedAt: this.now()
        });
      }
    }
    return { checked: candidates.length, submitted, failed };
  }

  /**
   * Gate-checked submission (Phase 9):
   *  - "skip": this logical action already confirmed — no new transaction.
   *  - "wait": a transaction for this action is pending (e.g. a crash between
   *            submit and receipt) — resolve that hash instead of submitting
   *            again (never double-submit).
   *  - "submit": fresh or previously reverted — submit and mark pending.
   * The receipt is then waited and recorded either way.
   */
  private async submit(
    candidate: AutomationCandidate,
    kind: AutomationRecord["kind"],
    detail: string,
    actionKey: string,
    prepare: () => Promise<PreparedTransaction>
  ): Promise<{ outcome: "submitted" | "waited" | "skipped"; success: boolean }> {
    try {
      const decision = await this.gate.decide(actionKey);
      if (decision === "skip") {
        return { outcome: "skipped", success: true };
      }
      let transactionHash: string;
      let outcome: "submitted" | "waited";
      if (decision === "wait") {
        const pending = await this.gate.pendingHash(actionKey);
        if (!pending) {
          transactionHash = await this.relayer.submit(candidate.deploymentKey, await prepare());
          await this.gate.markPending(actionKey, transactionHash, this.now());
          outcome = "submitted";
        } else {
          transactionHash = pending;
          outcome = "waited";
        }
      } else {
        transactionHash = await this.relayer.submit(candidate.deploymentKey, await prepare());
        await this.gate.markPending(actionKey, transactionHash, this.now());
        outcome = "submitted";
      }

      const receipt = await this.relayer.wait(candidate.deploymentKey, transactionHash);
      await this.gate.markConfirmed(actionKey, receipt.success, this.now(), detail);
      await this.saveAndNotify(candidate, {
        candidateId: candidate.id,
        kind,
        transactionHash,
        success: receipt.success,
        detail: receipt.success
          ? `${detail} confirmed at block ${receipt.blockNumber}${outcome === "waited" ? " (recovered pending submission)" : ""}`
          : `${detail} reverted`,
        recordedAt: this.now()
      });
      return { outcome, success: receipt.success };
    } catch (error) {
      await this.saveAndNotify(candidate, {
        candidateId: candidate.id,
        kind,
        success: false,
        detail: error instanceof Error ? error.message : `${detail} submission failed`,
        recordedAt: this.now()
      });
      return { outcome: "submitted", success: false };
    }
  }

  private async saveAndNotify(candidate: AutomationCandidate, record: AutomationRecord) {
    await this.records.record(record);
    await this.notifier.notify(candidate, record);
  }
}
