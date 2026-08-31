import assert from "node:assert/strict";
import test from "node:test";
import {
  AutomationWorker,
  InMemoryAutomationCandidateRepository,
  InMemoryAutomationRecordRepository,
  InMemorySubmissionGate,
  type AutomationCandidate,
  type AutomationGateway,
  type AutomationNotifier,
  type AutomationVaultState,
  type PendingDistribution,
  type RelayerSubmitter,
  type SubmissionGate
} from "../src/automation/AutomationWorker.js";
import { DurableSubmissionLedger } from "../src/db/DurableSubmissionLedger.js";
import { JsonFileDocumentStore } from "../src/db/DocumentStore.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
test("never double-submits: a confirmed action is skipped on later passes", async () => {
  const gateway = new SequenceGateway([
    state(status(true, false, true)),
    state(status(false, true, false), false),
    state(status(false, true, false), true)
  ]);
  const relayer = new FakeRelayer();
  const records = new InMemoryAutomationRecordRepository();
  const gate = new InMemorySubmissionGate();
  const worker = new AutomationWorker(
    new InMemoryAutomationCandidateRepository([candidate]), gateway, relayer, records, notifier, () => 1_000_000, gate
  );

  const first = await worker.runOnce();
  assert.deepEqual(relayer.submitted, ["0x01", "0x02"]);

  // Second pass: same logical actions are now `confirmed` -> skipped, no new submits.
  const second = await worker.runOnce();
  assert.equal(second.submitted, 0);
  assert.equal(relayer.submitted.length, 2);
});

test("crash between submit and wait recovers the pending transaction instead of re-submitting", async () => {
  // After the trigger is recovered (waited), further reads report a fully
  // processed vault, so the only candidate action is the recovered trigger.
  const gateway = new SequenceGateway([
    state(status(true, false, true)),
    state(status(false, true, false), true)
  ]);
  const relayer = new FakeRelayer();
  const records = new InMemoryAutomationRecordRepository();
  const gate = new InMemorySubmissionGate();
  const worker = new AutomationWorker(
    new InMemoryAutomationCandidateRepository([candidate]), gateway, relayer, records, notifier, () => 1_000_000, gate
  );
  // Simulate a crash after submit: the trigger is already pending in the gate.
  await gate.markPending(`${candidate.id}:trigger`, "0xPENDING");

  await worker.runOnce();
  // The trigger action was NOT re-submitted (no "0x01" trigger tx); the pending
  // hash was waited on instead.
  assert.ok(!relayer.submitted.includes("0x01"));
  assert.match(records.values[0]?.detail ?? "", /recovered pending submission/);
});

test("a reverted action is retried (not skipped)", async () => {
  const gateway = new SequenceGateway([
    state(status(true, false, true)),
    state(status(false, true, false))
  ]);
  const relayer = new FakeRelayer();
  relayer.success = false;
  const records = new InMemoryAutomationRecordRepository();
  const gate = new InMemorySubmissionGate();
  const worker = new AutomationWorker(
    new InMemoryAutomationCandidateRepository([candidate]), gateway, relayer, records, notifier, () => 1_000_000, gate
  );

  await gate.markConfirmed(`${candidate.id}:trigger`, false); // reverted previously
  await worker.runOnce();
  // reverted -> allowed to submit again
  assert.equal(relayer.submitted.length, 1);
});

test("concurrent runOnce calls are refused with an ingestion lock", async () => {
  let release!: () => void;
  const gatePromise = new Promise<void>((resolve) => { release = resolve; });
  const slowGateway: AutomationGateway = {
    async readState() { await gatePromise; return state(status(true, false, true)); },
    async prepareTrigger() { return tx("0x01"); },
    async prepareTokenDistribution() { return tx("0x02"); },
    async prepareRetry() { return tx("0x03"); },
    async prepareReserveClaim() { return tx("0x04"); }
  };
  const relayer = new FakeRelayer();
  const worker = new AutomationWorker(
    new InMemoryAutomationCandidateRepository([candidate]), slowGateway, relayer,
    new InMemoryAutomationRecordRepository(), notifier, () => 1000
  );

  const first = worker.runOnce();
  const second = await worker.runOnce(); // refused while the first is in progress
  assert.deepEqual(second, { checked: 0, submitted: 0, failed: 0, skipped: true });
  release();
  await first;
});

test("the durable submission ledger persists pending state across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinn-ledger-"));
  const store = new JsonFileDocumentStore(directory);
  const ledger = new DurableSubmissionLedger(store);
  await ledger.markPending("vault-1:trigger", "0xabc", 1000);

  const reopened = new DurableSubmissionLedger(new JsonFileDocumentStore(directory));
  assert.equal(await reopened.decide("vault-1:trigger"), "wait");
  assert.equal(await reopened.pendingHash("vault-1:trigger"), "0xabc");

  await reopened.markConfirmed("vault-1:trigger", true, 2000);
  assert.equal(await reopened.decide("vault-1:trigger"), "skip");

  const reopened2 = new DurableSubmissionLedger(new JsonFileDocumentStore(directory));
  assert.equal(await reopened2.decide("vault-1:trigger"), "skip");
});
