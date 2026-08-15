import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { KinnContractService } from "../src/blockchain/KinnContractService.js";
import type { RpcClient } from "../src/blockchain/RpcClient.js";
import { kinnAbi } from "../src/contracts/kinnAbi.js";
import type { ChainLog } from "../src/types.js";

const CONTRACT = "0x1000000000000000000000000000000000000000";
const OWNER = "0x2000000000000000000000000000000000000000";
const TOKEN = "0x3000000000000000000000000000000000000000";
const ALICE = "0x4000000000000000000000000000000000000000";

class MockRpc implements RpcClient {
  readonly iface = new Interface(kinnAbi);
  readonly metadataIface = new Interface([
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ]);

  async call(_to: string, data: string): Promise<string> {
    if (data.slice(0, 10) === this.metadataIface.getFunction("decimals")?.selector) {
      return this.metadataIface.encodeFunctionResult("decimals", [12]);
    }
    if (data.slice(0, 10) === this.metadataIface.getFunction("symbol")?.selector) {
      return this.metadataIface.encodeFunctionResult("symbol", ["tRWA"]);
    }
    const fragment = this.iface.getFunction(data.slice(0, 10));
    assert(fragment);
    switch (fragment.name) {
      case "getVault":
        return this.iface.encodeFunctionResult(fragment, [[OWNER, 1000n, 604800n, 3, true, false, 0n]]);
      case "getBeneficiaries":
        return this.iface.encodeFunctionResult(fragment, [[[ALICE, 10_000]]]);
      case "getVaultTokens":
        return this.iface.encodeFunctionResult(fragment, [[TOKEN]]);
      case "getTokenBalance":
        return this.iface.encodeFunctionResult(fragment, [5000n]);
      case "nextExpectedCheckIn":
        return this.iface.encodeFunctionResult(fragment, [605800n]);
      case "missedCheckIns":
        return this.iface.encodeFunctionResult(fragment, [1]);
      case "inheritanceEligible":
        return this.iface.encodeFunctionResult(fragment, [false]);
      default:
        throw new Error(`Unexpected call: ${fragment.name}`);
    }
  }

  async getLogs(): Promise<ChainLog[]> { return []; }
  async getBlockNumber(): Promise<number> { return 0; }
}

test("reads an aggregated vault status from blockchain state", async () => {
  const service = new KinnContractService(new MockRpc(), CONTRACT, 84532);
  const status = await service.getVaultStatus(OWNER);
  assert.equal(status.vault.owner, OWNER);
  assert.equal(status.vault.checkInInterval, 604800n);
  assert.deepEqual(status.beneficiaries, [{ account: ALICE, allocationBps: 10_000 }]);
  assert.deepEqual(status.tokens, [TOKEN]);
  assert.equal(status.balances[TOKEN], 5000n);
  assert.equal(status.missedCheckIns, 1);
  assert.equal(status.inheritanceEligible, false);
});

test("prepares unsigned owner transactions without a signer", () => {
  const service = new KinnContractService(new MockRpc(), CONTRACT, 84532);
  const transaction = service.prepareDeposit(TOKEN, 2500n);
  assert.equal(transaction.to, CONTRACT);
  assert.equal(transaction.chainId, 84532);
  assert.equal(transaction.value, "0x00");
  const decoded = service.interface.decodeFunctionData("deposit", transaction.data);
  assert.equal(decoded.token, TOKEN);
  assert.equal(decoded.amount, 2500n);
});

test("prepares native automation reserve value separately from calldata", () => {
  const service = new KinnContractService(new MockRpc(), CONTRACT, 84532);
  const transaction = service.prepareTopUpAutomationReserve(1000n);
  assert.equal(transaction.value, "0x03e8");
  assert.equal(service.interface.parseTransaction({ data: transaction.data })?.name, "topUpAutomationReserve");
});

test("prepares check-in and inheritance maintenance calls", () => {
  const service = new KinnContractService(new MockRpc(), CONTRACT, 84532);
  assert.equal(service.interface.parseTransaction({ data: service.prepareCheckIn().data })?.name, "checkIn");
  assert.equal(
    service.interface.parseTransaction({ data: service.prepareTriggerInheritance(OWNER).data })?.name,
    "triggerInheritance"
  );
  assert.equal(
    service.interface.parseTransaction({ data: service.prepareTokenDistribution(OWNER, TOKEN).data })?.name,
    "distributeInheritanceToken"
  );
});

test("rejects invalid addresses before RPC or transaction preparation", () => {
  const service = new KinnContractService(new MockRpc(), CONTRACT, 84532);
  assert.throws(() => service.prepareWithdraw("not-an-address", 1n));
});

test("parses human token amounts using on-chain decimals", async () => {
  const service = new KinnContractService(new MockRpc(), CONTRACT, 84532);
  assert.equal(await service.parseTokenAmount(TOKEN, "1.25"), 1_250_000_000_000n);
});

test("formats token metadata for user-facing balances", async () => {
  const service = new KinnContractService(new MockRpc(), CONTRACT, 84532);
  assert.deepEqual(await service.getTokenDisplay(OWNER, TOKEN, 75_000_000_000_000n), {
    address: TOKEN,
    symbol: "tRWA",
    decimals: 12,
    rawBalance: 75_000_000_000_000n,
    formattedBalance: "75.0"
  });
});
