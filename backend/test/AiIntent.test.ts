import assert from "node:assert/strict";
import test from "node:test";
import { validateAiAction } from "../src/ai/intent.js";

const ALICE = "0x4000000000000000000000000000000000000000";
const BOB = "0x5000000000000000000000000000000000000000";

const envelope = (overrides: Record<string, unknown>) => ({
  action: "clarification",
  beneficiaries: [],
  checkInIntervalSeconds: null,
  maxMissedCheckIns: null,
  tokenAddress: null,
  amount: null,
  amountUnit: null,
  message: "Please clarify.",
  ...overrides
});

test("validates a structured beneficiary update", () => {
  const action = validateAiAction(envelope({
    action: "update_beneficiaries",
    beneficiaries: [
      { address: ALICE, allocationBps: 6000 },
      { address: BOB, allocationBps: 4000 }
    ]
  }));
  assert.deepEqual(action, {
    action: "update_beneficiaries",
    accounts: [ALICE, BOB],
    allocationsBps: [6000, 4000]
  });
});

test("rejects AI allocations that do not total exactly 100 percent", () => {
  assert.throws(() => validateAiAction(envelope({
    action: "update_beneficiaries",
    beneficiaries: [{ address: ALICE, allocationBps: 9999 }]
  })), /exactly 10000/);
});

test("rejects model-generated settings beyond contract limits", () => {
  assert.throws(() => validateAiAction(envelope({
    action: "update_settings",
    checkInIntervalSeconds: String(20 * 7 * 24 * 60 * 60),
    maxMissedCheckIns: 3
  })), /9 weeks/);
  assert.throws(() => validateAiAction(envelope({
    action: "update_settings",
    checkInIntervalSeconds: "604800",
    maxMissedCheckIns: 6
  })), /between 1 and 5/);
});

test("rejects invalid addresses and zero token amounts", () => {
  assert.throws(() => validateAiAction(envelope({
    action: "deposit", tokenAddress: "not-an-address", amount: "100", amountUnit: "raw"
  })));
  assert.throws(() => validateAiAction(envelope({
    action: "withdraw", tokenAddress: ALICE, amount: "0", amountUnit: "raw"
  })), /greater than zero/);
});

test("rejects ambiguous human-readable token amounts", () => {
  assert.throws(() => validateAiAction(envelope({
    action: "deposit", tokenAddress: ALICE, amount: "10", amountUnit: null
  })), /raw units/);
});

test("unsupported or injected actions cannot reach the backend", () => {
  assert.throws(() => validateAiAction(envelope({ action: "send_private_key_to_user" })), /Unsupported/);
  assert.throws(() => validateAiAction(envelope({ action: "execute_transaction_without_signature" })), /Unsupported/);
});
