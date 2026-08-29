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

export class InMemoryAutomationCandidateRepository implements AutomationCandidateRepository {
  constructor(private readonly values: AutomationCandidate[]) {}
  async listCandidates() { return this.values; }
}

export class InMemoryAutomationRecordRepository implements AutomationRecordRepository {
  readonly values: AutomationRecord[] = [];
  async record(value: AutomationRecord) { this.values.push(value); }
}

export class AutomationWorker {
  constructor(
    private readonly candidates: AutomationCandidateRepository,
    private readonly gateway: AutomationGateway,
    private readonly relayer: RelayerSubmitter,
    private readonly records: AutomationRecordRepository,
    private readonly notifier: AutomationNotifier,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000)
  ) {}

  async runOnce(): Promise<{ checked: number; submitted: number; failed: number }> {
    const candidates = await this.candidates.listCandidates();
    let submitted = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        let state = await this.gateway.readState(candidate);
        if (state.status.vault.active && !state.status.vault.inheritanceTriggered && state.status.inheritanceEligible) {
          const success = await this.submit(candidate, "trigger", await this.gateway.prepareTrigger(candidate), "inheritance trigger");
          submitted += 1;
          if (!success) { failed += 1; continue; }
          state = await this.gateway.readState(candidate);
        }

        if (!state.status.vault.inheritanceTriggered) continue;
        for (const token of state.status.tokens) {
          if (state.processedTokens[token]) continue;
          const success = await this.submit(
            candidate, "distribute", await this.gateway.prepareTokenDistribution(candidate, token), `token distribution ${token}`
          );
          submitted += 1;
          if (!success) failed += 1;
        }

        state = await this.gateway.readState(candidate);
        for (const pending of state.pendingDistributions) {
          if (pending.amount === 0n || BigInt(this.now()) < pending.nextRetryAt) continue;
          const success = await this.submit(
            candidate, "retry", await this.gateway.prepareRetry(candidate, pending),
            `retry ${pending.token} to ${pending.beneficiary}`
          );
          submitted += 1;
          if (!success) failed += 1;
        }

        state = await this.gateway.readState(candidate);
        const allTokensProcessed = state.status.tokens.every((token) => state.processedTokens[token]);
        if (
          state.status.vault.inheritanceTriggered &&
          allTokensProcessed &&
          state.pendingDistributions.length === 0 &&
          state.status.vault.automationReserve > 0n
        ) {
          const success = await this.submit(
            candidate, "claim", await this.gateway.prepareReserveClaim(candidate), "completed automation reserve claim"
          );
          submitted += 1;
          if (!success) failed += 1;
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

  private async submit(
    candidate: AutomationCandidate,
    kind: AutomationRecord["kind"],
    transaction: PreparedTransaction,
    detail: string
  ): Promise<boolean> {
    try {
      const transactionHash = await this.relayer.submit(candidate.deploymentKey, transaction);
      const receipt = await this.relayer.wait(candidate.deploymentKey, transactionHash);
      const record: AutomationRecord = {
        candidateId: candidate.id,
        kind,
        transactionHash,
        success: receipt.success,
        detail: receipt.success ? `${detail} confirmed at block ${receipt.blockNumber}` : `${detail} reverted`,
        recordedAt: this.now()
      };
      await this.saveAndNotify(candidate, record);
      return receipt.success;
    } catch (error) {
      await this.saveAndNotify(candidate, {
        candidateId: candidate.id,
        kind,
        success: false,
        detail: error instanceof Error ? error.message : `${detail} submission failed`,
        recordedAt: this.now()
      });
      return false;
    }
  }

  private async saveAndNotify(candidate: AutomationCandidate, record: AutomationRecord) {
    await this.records.record(record);
    await this.notifier.notify(candidate, record);
  }
}
