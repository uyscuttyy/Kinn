import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { KinnContractService } from "../src/blockchain/KinnContractService.js";
import type { RpcClient } from "../src/blockchain/RpcClient.js";
import { factoryAbi } from "../src/contracts/factoryAbi.js";
import { ETH_SENTINEL, vaultAbi } from "../src/contracts/vaultAbi.js";
import type { ChainLog } from "../src/types.js";

const FACTORY = "0x1000000000000000000000000000000000000000";
const INSTANCE = "0x5000000000000000000000000000000000000000";
const OWNER = "0x2000000000000000000000000000000000000000";
const OTHER = "0x6000000000000000000000000000000000000000"; // no vault
const TOKEN = "0x3000000000000000000000000000000000000000";
const ALICE = "0x4000000000000000000000000000000000000000";
/** Mock RPC that dispatches factory vs instance vs token metadata by address. */
class MockRpc implements RpcClient {
  readonly factory = new Interface(factoryAbi);
  readonly instance = new Interface(vaultAbi);
  readonly metadata = new Interface(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
  readonly instanceClosed: boolean;
  readonly instanceTriggered = false;
  readonly stateValue = 0; // Active

  constructor(instanceClosed = false) {
    this.instanceClosed = instanceClosed;
  }

  async call(to: string, data: string): Promise<string> {
    // Token metadata calls.
    if (data.slice(0, 10) === this.metadata.getFunction("decimals")?.selector) {
      return this.metadata.encodeFunctionResult("decimals", [12]);
    }
    if (data.slice(0, 10) === this.metadata.getFunction("symbol")?.selector) {
      return this.metadata.encodeFunctionResult("symbol", ["tRWA"]);
    }
    const lower = to.toLowerCase();
    if (lower !== FACTORY.toLowerCase() && lower !== INSTANCE.toLowerCase()) {
      throw new Error(`Unexpected call target ${to}`);
    }
    if (lower === FACTORY.toLowerCase()) {
      const f = this.factory.getFunction(data.slice(0, 10));
      assert(f, `Unknown factory call ${data.slice(0, 10)}`);
      switch (f.name) {
        case "vaultOf": {
          const [owner] = this.factory.decodeFunctionData(f, data);
          return this.factory.encodeFunctionResult(f, [owner.toLowerCase() === OWNER.toLowerCase() ? INSTANCE : "0x0000000000000000000000000000000000000000"]);
        }
        case "isVault": {
          const [candidate] = this.factory.decodeFunctionData(f, data);
          return this.factory.encodeFunctionResult(f, [candidate.toLowerCase() === INSTANCE.toLowerCase()]);
        }
        case "automationFeeWei":
          return this.factory.encodeFunctionResult(f, [100_000_000_000_000_000n]);
        default:
          throw new Error(`Unexpected factory call: ${f.name}`);
      }
    }
    // Instance reads.
    const g = this.instance.getFunction(data.slice(0, 10));
    assert(g, `Unknown instance call ${data.slice(0, 10)}`);
    switch (g.name) {
      case "owner": return this.instance.encodeFunctionResult(g, [OWNER]);
      case "factory": return this.instance.encodeFunctionResult(g, [FACTORY]);
      case "closed": return this.instance.encodeFunctionResult(g, [this.instanceClosed]);
      case "inheritanceTriggered": return this.instance.encodeFunctionResult(g, [this.instanceTriggered]);
      case "lastCheckIn": return this.instance.encodeFunctionResult(g, [1000n]);
      case "checkInInterval": return this.instance.encodeFunctionResult(g, [604800n]);
      case "maxMissedCheckIns": return this.instance.encodeFunctionResult(g, [3]);
      case "automationReserve": return this.instance.encodeFunctionResult(g, [123n]);
      case "automationFeeWei": return this.instance.encodeFunctionResult(g, [100_000_000_000_000_000n]);
      case "state": return this.instance.encodeFunctionResult(g, [this.stateValue]);
      case "inheritanceEligible": return this.instance.encodeFunctionResult(g, [false]);
      case "eligibilityDeadline": return this.instance.encodeFunctionResult(g, [1000n + 604800n * 3n]);
      case "nextExpectedCheckIn": return this.instance.encodeFunctionResult(g, [605800n]);
      case "missedCheckIns": return this.instance.encodeFunctionResult(g, [1]);
      case "getBeneficiaries": return this.instance.encodeFunctionResult(g, [[[ALICE, 10_000]]]);
      case "getTrackedAssets": return this.instance.encodeFunctionResult(g, [[ETH_SENTINEL, TOKEN]]);
      case "protectedAssetBalance": return this.instance.encodeFunctionResult(g, [5000n]);
      case "inheritanceAssetProcessed": return this.instance.encodeFunctionResult(g, [false]);
      case "pendingInheritance": return this.instance.encodeFunctionResult(g, [0n]);
      case "nextDistributionRetry": return this.instance.encodeFunctionResult(g, [0n]);
      default: throw new Error(`Unexpected instance call: ${g.name}`);
    }
  }

  async getLogs(): Promise<ChainLog[]> { return []; }
  async getBlockNumber(): Promise<number> { return 0; }
}

const make = (rpc?: MockRpc, closed = false): KinnContractService =>
  new KinnContractService(rpc ?? new MockRpc(closed), FACTORY, 84532);

test("discovers the owner's vault through the factory registry", async () => {
  const service = make();
  assert.equal(await service.discoverVault(OWNER), INSTANCE);
  assert.equal(await service.discoverVault(OTHER), null);
  assert.equal(await service.isVault(INSTANCE), true);
  assert.equal(await service.isVault(OTHER), false);
});

test("getVaultStatus aggregates factory-resolved instance reads", async () => {
  const service = make();
  const status = await service.getVaultStatus(OWNER);
  assert.equal(status.vault.owner, OWNER);
  assert.equal(status.vault.address, INSTANCE);
  assert.equal(status.vault.lastCheckIn, 1000n);
  assert.equal(status.vault.checkInInterval, 604800n);
  assert.equal(status.vault.maxMissedCheckIns, 3);
  assert.equal(status.vault.active, true);
  assert.equal(status.vault.automationReserve, 123n);
  assert.deepEqual(status.tokens, [ETH_SENTINEL, TOKEN]);
  assert.equal(status.balances[TOKEN], 5000n);
  assert.equal(status.balances[ETH_SENTINEL], 5000n);
  assert.deepEqual(status.beneficiaries, [{ account: ALICE, allocationBps: 10_000 }]);
  assert.equal(status.missedCheckIns, 1);
  assert.equal(status.inheritanceEligible, false);
});

test("state() maps the on-chain enum to a stable name", async () => {
  const service = make();
  assert.equal(await service.getState(OWNER), "Active");
});

test("reading an owner with no vault surfaces a clear error", async () => {
  const service = make();
  await assert.rejects(service.getVaultStatus(OTHER), /No vault exists/);
});

test("prepareCreateVault targets the factory, not an instance", async () => {
  const service = make();
  const tx = service.prepareCreateVault(604800n, 3, [ALICE], [10_000]);
  assert.equal(tx.to, FACTORY);
  assert.equal(tx.chainId, 84532);
  assert.equal(new Interface(factoryAbi).parseTransaction({ data: tx.data })?.name, "createVault");
  const decoded = new Interface(factoryAbi).decodeFunctionData("createVault", tx.data);
  assert.equal(decoded.maxMissedCheckIns, 3n);
});
test("owner actions target the owner's vault instance", async () => {
  const service = make();
  const deposit = await service.prepareDeposit(OWNER, TOKEN, 2500n);
  assert.equal(deposit.to, INSTANCE);
  const decodedDeposit = service.interface.decodeFunctionData("deposit", deposit.data);
  assert.equal(decodedDeposit.token.toLowerCase(), TOKEN);
  assert.equal(decodedDeposit.amount, 2500n);

  const checkIn = await service.prepareCheckIn(OWNER);
  assert.equal(checkIn.to, INSTANCE);
  assert.equal(service.interface.parseTransaction({ data: checkIn.data })?.name, "checkIn");

  const withdraw = await service.prepareWithdraw(OWNER, TOKEN, 1n);
  assert.equal(withdraw.to, INSTANCE);
  assert.equal(service.interface.parseTransaction({ data: withdraw.data })?.name, "withdraw");
});

test("permissionless keeper actions target the instance and drop the owner arg", async () => {
  const service = make();
  const trigger = await service.prepareTriggerInheritance(OWNER);
  assert.equal(trigger.to, INSTANCE);
  assert.equal(service.interface.parseTransaction({ data: trigger.data })?.name, "triggerInheritance");

  const distribute = await service.prepareTokenDistribution(OWNER, TOKEN);
  assert.equal(service.interface.parseTransaction({ data: distribute.data })?.name, "distributeInheritanceAsset");
  assert.equal(service.interface.decodeFunctionData("distributeInheritanceAsset", distribute.data).asset, TOKEN);

  const retry = await service.prepareDistributionRetry(OWNER, TOKEN, ALICE);
  assert.equal(service.interface.parseTransaction({ data: retry.data })?.name, "retryInheritanceDistribution");

  const claim = await service.prepareClaimAutomationReserve(OWNER);
  assert.equal(service.interface.parseTransaction({ data: claim.data })?.name, "claimAutomationReserve");
});

test("automation reserve top-up carries the native amount in tx.value", async () => {
  const service = make();
  const tx = await service.prepareTopUpAutomationReserve(OWNER, 1000n);
  assert.equal(tx.to, INSTANCE);
  assert.equal(tx.value, "0x03e8");
  assert.equal(service.interface.parseTransaction({ data: tx.data })?.name, "topUpAutomationReserve");
});

test("token approval approves the owner's resolved instance as spender", async () => {
  const service = make();
  const tx = await service.prepareTokenApproval(OWNER, TOKEN, 500n);
  assert.equal(tx.to, TOKEN);
  const erc20 = new Interface(["function approve(address spender,uint256 amount) returns (bool)"]);
  const decoded = erc20.decodeFunctionData("approve", tx.data);
  assert.equal(decoded.spender, INSTANCE);
  assert.equal(decoded.amount, 500n);
});

test("native ETH is displayed with fixed metadata, ERC-20 with on-chain metadata", async () => {
  const service = make();
  assert.deepEqual(await service.getAssetDisplay(OWNER, ETH_SENTINEL, 1_000_000_000_000_000_000n), {
    address: ETH_SENTINEL, symbol: "ETH", decimals: 18, rawBalance: 1_000_000_000_000_000_000n, formattedBalance: "1.0"
  });
  assert.deepEqual(await service.getAssetDisplay(OWNER, TOKEN, 75_000_000_000_000n), {
    address: TOKEN, symbol: "tRWA", decimals: 12, rawBalance: 75_000_000_000_000n, formattedBalance: "75.0"
  });
});

test("parseTokenAmount uses on-chain decimals and rejects invalid inputs", async () => {
  const service = make();
  assert.equal(await service.parseTokenAmount(TOKEN, "1.25"), 1_250_000_000_000n);
  await assert.rejects(service.parseTokenAmount(TOKEN, "-1"));
  await assert.rejects(service.parseTokenAmount(TOKEN, "abc"));
});

test("a closed vault reports inactive", async () => {
  const service = make(undefined, true);
  const vault = await service.getVault(OWNER);
  assert.equal(vault.active, false);
});