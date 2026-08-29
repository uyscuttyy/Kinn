import assert from "node:assert/strict";
import test from "node:test";
import {
  AutomationWorker,
  InMemoryAutomationCandidateRepository,
  InMemoryAutomationRecordRepository,
  type AutomationCandidate,
  type AutomationGateway,
  type AutomationNotifier,
  type AutomationVaultState,
  type PendingDistribution,
  type RelayerSubmitter
} from "../src/automation/AutomationWorker.js";
import type { PreparedTransaction, VaultStatus } from "../src/types.js";

const OWNER = "0x2000000000000000000000000000000000000000";
const TOKEN = "0x3000000000000000000000000000000000000000";
const ALICE = "0x4000000000000000000000000000000000000000";
const candidate: AutomationCandidate = { id: "vault-1", deploymentKey: "bot-testnet", owner: OWNER };

function status(active: boolean, triggered: boolean, eligible: boolean): VaultStatus {
  return {
    vault: {
      owner: OWNER, lastCheckIn: 1000n, checkInInterval: 604800n,
      maxMissedCheckIns: 3, active, inheritanceTriggered: triggered, automationReserve: 0n
    },
    beneficiaries: [{ account: ALICE, allocationBps: 10_000 }],
    tokens: [TOKEN], balances: { [TOKEN]: triggered ? 0n : 1000n },
    nextExpectedCheckIn: 605800n, missedCheckIns: eligible ? 3 : 0, inheritanceEligible: eligible
  };
}

const state = (
  vaultStatus: VaultStatus,
  processed = false,
  pendingDistributions: PendingDistribution[] = []
): AutomationVaultState => ({ status: vaultStatus, processedTokens: { [TOKEN]: processed }, pendingDistributions });

class SequenceGateway implements AutomationGateway {
  index = 0;
  constructor(private readonly states: AutomationVaultState[]) {}
  async readState() { return this.states[Math.min(this.index++, this.states.length - 1)] as AutomationVaultState; }
  async prepareTrigger() { return tx("0x01"); }
  async prepareTokenDistribution() { return tx("0x02"); }
  async prepareRetry() { return tx("0x03"); }
  async prepareReserveClaim() { return tx("0x04"); }
}

class FakeRelayer implements RelayerSubmitter {
  submitted: string[] = [];
  success = true;
  async submit(_deployment: string, transaction: PreparedTransaction) {
    this.submitted.push(transaction.data);
    return `0x${String(this.submitted.length).padStart(64, "0")}`;
  }
  async wait(_deployment: string, transactionHash: string) {
    return { transactionHash, blockNumber: 100 + this.submitted.length, success: this.success };
  }
}

const tx = (data: string): PreparedTransaction => ({ chainId: 12345, to: OWNER, data, value: "0x0" });
const notifier: AutomationNotifier = { async notify() {} };

test("triggers eligible inheritance, waits, then processes each unprocessed token", async () => {
  const gateway = new SequenceGateway([
    state(status(true, false, true)),
    state(status(false, true, false), false),
    state(status(false, true, false), true)
  ]);
  const relayer = new FakeRelayer();
  const records = new InMemoryAutomationRecordRepository();
  const worker = new AutomationWorker(
    new InMemoryAutomationCandidateRepository([candidate]), gateway, relayer, records, notifier, () => 1_000_000
  );
  assert.deepEqual(await worker.runOnce(), { checked: 1, submitted: 2, failed: 0 });
  assert.deepEqual(relayer.submitted, ["0x01", "0x02"]);
  assert.deepEqual(records.values.map((record) => record.kind), ["trigger", "distribute"]);
  assert.ok(records.values.every((record) => record.success));
});

test("submits only due pending retries", async () => {
  const pending = { token: TOKEN, beneficiary: ALICE, amount: 1000n, nextRetryAt: 900n };
  const gateway = new SequenceGateway([
    state(status(false, true, false), true, [pending]),
    state(status(false, true, false), true, [pending])
  ]);
  const relayer = new FakeRelayer();
  const records = new InMemoryAutomationRecordRepository();
  const worker = new AutomationWorker(
    new InMemoryAutomationCandidateRepository([candidate]), gateway, relayer, records, notifier, () => 1000
  );
  assert.deepEqual(await worker.runOnce(), { checked: 1, submitted: 1, failed: 0 });
  assert.deepEqual(relayer.submitted, ["0x03"]);
});

test("is safe to rerun when inheritance and token processing are already complete", async () => {
  const gateway = new SequenceGateway([state(status(false, true, false), true)]);
  const relayer = new FakeRelayer();
  const worker = new AutomationWorker(
    new InMemoryAutomationCandidateRepository([candidate]), gateway, relayer,
    new InMemoryAutomationRecordRepository(), notifier, () => 1000
  );
  assert.deepEqual(await worker.runOnce(), { checked: 1, submitted: 0, failed: 0 });
  assert.deepEqual(await worker.runOnce(), { checked: 1, submitted: 0, failed: 0 });
  assert.equal(relayer.submitted.length, 0);
});

test("records reverted relayer transactions and does not continue dependent work", async () => {
  const gateway = new SequenceGateway([state(status(true, false, true))]);
  const relayer = new FakeRelayer();
  relayer.success = false;
  const records = new InMemoryAutomationRecordRepository();
  const worker = new AutomationWorker(
    new InMemoryAutomationCandidateRepository([candidate]), gateway, relayer, records, notifier, () => 1000
  );
  assert.deepEqual(await worker.runOnce(), { checked: 1, submitted: 1, failed: 1 });
  assert.equal(records.values[0]?.success, false);
  assert.match(records.values[0]?.detail ?? "", /reverted/);
});
