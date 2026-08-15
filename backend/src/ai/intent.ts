import { getAddress } from "ethers";

export const MAX_INTERVAL_SECONDS = 9n * 7n * 24n * 60n * 60n;
export const MAX_BENEFICIARIES = 50;

export interface AiActionEnvelope {
  action: string;
  beneficiaries: { address: string; allocationBps: number }[];
  checkInIntervalSeconds: string | null;
  maxMissedCheckIns: number | null;
  tokenAddress: string | null;
  amount: string | null;
  amountUnit: "raw" | null;
  message: string | null;
}

export type ValidatedAiAction =
  | { action: "read_vault" | "read_status" | "read_beneficiaries" | "read_settings" }
  | { action: "create_vault"; interval: bigint; maxMisses: number; accounts: string[]; allocationsBps: number[] }
  | { action: "update_beneficiaries"; accounts: string[]; allocationsBps: number[] }
  | { action: "update_settings"; interval: bigint; maxMisses: number }
  | { action: "check_in" }
  | { action: "deposit" | "withdraw"; token: string; amount: bigint }
  | { action: "clarification"; message: string };

export function validateAiAction(raw: unknown): ValidatedAiAction {
  if (!raw || typeof raw !== "object") throw new Error("AI output must be an object");
  const value = raw as Partial<AiActionEnvelope>;
  const action = value.action;
  if (typeof action !== "string") throw new Error("AI action is missing");

  if (["read_vault", "read_status", "read_beneficiaries", "read_settings", "check_in"].includes(action)) {
    return { action } as ValidatedAiAction;
  }
  if (action === "clarification") {
    if (typeof value.message !== "string" || value.message.trim().length === 0) {
      throw new Error("AI clarification message is missing");
    }
    return { action, message: value.message.trim().slice(0, 1000) };
  }
  if (action === "create_vault" || action === "update_settings") {
    const interval = parseBoundedInteger(value.checkInIntervalSeconds, "check-in interval");
    if (interval <= 0n || interval > MAX_INTERVAL_SECONDS) throw new Error("Check-in interval must be between 1 second and 9 weeks");
    const maxMisses = value.maxMissedCheckIns;
    if (typeof maxMisses !== "number" || !Number.isInteger(maxMisses) || maxMisses < 1 || maxMisses > 5) throw new Error("Maximum missed check-ins must be between 1 and 5");
    if (action === "update_settings") return { action, interval, maxMisses };
    const beneficiaries = validateBeneficiaries(value.beneficiaries);
    return { action, interval, maxMisses, accounts: beneficiaries.accounts, allocationsBps: beneficiaries.allocationsBps };
  }
  if (action === "update_beneficiaries") {
    const beneficiaries = validateBeneficiaries(value.beneficiaries);
    return { action, accounts: beneficiaries.accounts, allocationsBps: beneficiaries.allocationsBps };
  }
  if (action === "deposit" || action === "withdraw") {
    if (typeof value.tokenAddress !== "string") throw new Error("Token address is required");
    if (value.amountUnit !== "raw") throw new Error("Token amount must be explicitly provided in raw units");
    const token = getAddress(value.tokenAddress);
    const amount = parseBoundedInteger(value.amount, "amount");
    if (amount <= 0n) throw new Error("Amount must be greater than zero");
    return { action, token, amount };
  }
  throw new Error(`Unsupported AI action: ${action}`);
}

function validateBeneficiaries(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("At least one beneficiary is required");
  if (value.length > MAX_BENEFICIARIES) throw new Error("Too many beneficiaries");
  const accounts: string[] = [];
  const allocationsBps: number[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid beneficiary entry");
    const item = entry as { address?: unknown; allocationBps?: unknown };
    if (typeof item.address !== "string") throw new Error("Beneficiary address is required");
    const account = getAddress(item.address);
    if (seen.has(account)) throw new Error("Duplicate beneficiary address");
    if (!Number.isInteger(item.allocationBps) || (item.allocationBps as number) <= 0) throw new Error("Beneficiary allocation must be positive");
    seen.add(account);
    accounts.push(account);
    allocationsBps.push(item.allocationBps as number);
    total += item.allocationBps as number;
  }
  if (total !== 10_000) throw new Error("Beneficiary allocations must total exactly 10000 basis points");
  return { accounts, allocationsBps };
}

function parseBoundedInteger(value: unknown, label: string): bigint {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") throw new Error(`${label} is required`);
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a non-negative integer`);
  try { return BigInt(text); } catch { throw new Error(`${label} is invalid`); }
}
