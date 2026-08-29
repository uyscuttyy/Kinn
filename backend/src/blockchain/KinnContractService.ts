import { formatUnits, getAddress, Interface, parseUnits, toBeHex } from "ethers";
import { factoryAbi } from "../contracts/factoryAbi.js";
import {
  ETH_SENTINEL,
  inheritanceStateName,
  type InheritanceStateName,
  vaultAbi
} from "../contracts/vaultAbi.js";
import type { BeneficiaryView, PreparedTransaction, TokenDisplay, VaultStatus, VaultView } from "../types.js";
import type { RpcClient } from "./RpcClient.js";

/**
 * Factory + instance contract service (Phase 6).
 *
 * Resolves an owner's vault through the factory's `vaultOf` registry and reads
 * instance-local state. Owner actions and permissionless keeper/manager actions
 * are prepared as UNSIGNED transactions targeting the correct contract: the
 * factory for `createVault`, the instance for everything else. The backend
 * never signs or submits — the wallet (now the first-party KeyManager) is the
 * only signer.
 *
 * `contractAddress` is the per-chain VaultFactory address.
 */
export class KinnContractService {
  readonly factoryAddress: string;
  readonly chainId: number;
  readonly interface: Interface;
  private readonly factoryInterface = new Interface(factoryAbi);
  private readonly instanceInterface = new Interface(vaultAbi);
  private readonly erc20Interface = new Interface(["function approve(address spender,uint256 amount) returns (bool)"]);
  private readonly erc20MetadataInterface = new Interface([
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ]);

  constructor(private readonly rpc: RpcClient, factoryAddress: string, chainId: number) {
    this.factoryAddress = getAddress(factoryAddress);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid chain ID");
    this.chainId = chainId;
    // Backwards-compatible alias: `interface` parses instance transactions.
    this.interface = this.instanceInterface;
  }

  // ---- Factory discovery --------------------------------------------------

  /**
   * The instance address registered for an owner, or `null` if the owner has
   * not created a vault.
   */
  async discoverVault(owner: string): Promise<string | null> {
    const vault = (await this.callFactory("vaultOf", [this.address(owner)]))[0] as string;
    if (vault === "0x0000000000000000000000000000000000000000") return null;
    return getAddress(vault);
  }

  /** Whether the factory recognizes an address as a vault it deployed. */
  async isVault(candidate: string): Promise<boolean> {
    return (await this.callFactory("isVault", [this.address(candidate)]))[0] as boolean;
  }

  async getFactoryAutomationFee(): Promise<bigint> {
    return (await this.callFactory("automationFeeWei", []))[0] as bigint;
  }

  // ---- Instance reads -----------------------------------------------------

  async getVault(owner: string): Promise<VaultView> {
    const instance = await this.instanceOf(owner);
    const [ownerAddr, closed, triggered, lastCheckIn, interval, maxMissed, reserve] = await Promise.all([
      this.callInstance(instance, "owner", []),
      this.callInstance(instance, "closed", []),
      this.callInstance(instance, "inheritanceTriggered", []),
      this.callInstance(instance, "lastCheckIn", []),
      this.callInstance(instance, "checkInInterval", []),
      this.callInstance(instance, "maxMissedCheckIns", []),
      this.callInstance(instance, "automationReserve", [])
    ]);
    return {
      owner: getAddress(ownerAddr[0] as string),
      address: instance,
      lastCheckIn: lastCheckIn[0] as bigint,
      checkInInterval: interval[0] as bigint,
      maxMissedCheckIns: Number(maxMissed[0]),
      active: closed[0] !== true,
      inheritanceTriggered: triggered[0] === true,
      automationReserve: reserve[0] as bigint
    };
  }

  /** The on-chain inheritance state, mapped to a stable name. */
  async getState(owner: string): Promise<InheritanceStateName> {
    const instance = await this.instanceOf(owner);
    const result = await this.callInstance(instance, "state", []);
    return inheritanceStateName(Number(result[0]));
  }

  async getInheritanceEligible(owner: string): Promise<boolean> {
    return (await this.instanceRead(owner, "inheritanceEligible", []))[0] as boolean;
  }

  async getEligibilityDeadline(owner: string): Promise<bigint> {
    return (await this.instanceRead(owner, "eligibilityDeadline", []))[0] as bigint;
  }

  async getBeneficiaries(owner: string): Promise<BeneficiaryView[]> {
    const result = await this.instanceRead(owner, "getBeneficiaries", []);
    return result[0].map((entry: { account: string; allocationBps: bigint }) => ({
      account: getAddress(entry.account),
      allocationBps: Number(entry.allocationBps)
    }));
  }

  async getTrackedAssets(owner: string): Promise<string[]> {
    const result = await this.instanceRead(owner, "getTrackedAssets", []);
    return (result[0] as string[]).map(getAddress);
  }

  async getAssetBalance(owner: string, asset: string): Promise<bigint> {
    return (await this.instanceRead(owner, "protectedAssetBalance", [this.address(asset)]))[0] as bigint;
  }

  async getTokenBalances(owner: string): Promise<Record<string, bigint>> {
    const assets = await this.getTrackedAssets(owner);
    const entries = await Promise.all(
      assets.map(async (asset) => [asset, await this.getAssetBalance(owner, asset)] as const)
    );
    return Object.fromEntries(entries);
  }

  async isInheritanceAssetProcessed(owner: string, asset: string): Promise<boolean> {
    return (await this.instanceRead(owner, "inheritanceAssetProcessed", [this.address(asset)]))[0] as boolean;
  }

  async getPendingInheritance(owner: string, asset: string, beneficiary: string): Promise<bigint> {
    return (await this.instanceRead(owner, "pendingInheritance", [
      this.address(asset), this.address(beneficiary)
    ]))[0] as bigint;
  }

  async getNextDistributionRetry(owner: string, asset: string, beneficiary: string): Promise<bigint> {
    return (await this.instanceRead(owner, "nextDistributionRetry", [
      this.address(asset), this.address(beneficiary)
    ]))[0] as bigint;
  }

  async getVaultStatus(owner: string): Promise<VaultStatus> {
    const normalizedOwner = this.address(owner);
    // Resolve the instance once up-front so an owner with no vault rejects
    // before the parallel reads are even scheduled (avoids orphaned promises).
    const instance = await this.resolveInstance(normalizedOwner);
    const [vault, beneficiaries, tokens, nextExpected, missed, eligible, balances] = await Promise.all([
      this.getVault(normalizedOwner),
      this.getBeneficiaries(normalizedOwner),
      this.getTrackedAssets(normalizedOwner),
      this.callInstance(instance, "nextExpectedCheckIn", []),
      this.callInstance(instance, "missedCheckIns", []),
      this.getInheritanceEligible(normalizedOwner),
      this.getTokenBalances(normalizedOwner)
    ]);
    return {
      vault,
      beneficiaries,
      tokens,
      balances,
      nextExpectedCheckIn: nextExpected[0],
      missedCheckIns: Number(missed[0]),
      inheritanceEligible: eligible
    };
  }
// ---- ERC-20 metadata (token display) -----------------------------------

  async getTokenDecimals(token: string): Promise<number> {
    const data = this.erc20MetadataInterface.encodeFunctionData("decimals", []);
    const encoded = await this.rpc.call(this.address(token), data);
    return Number(this.erc20MetadataInterface.decodeFunctionResult("decimals", encoded)[0]);
  }

  async getTokenSymbol(token: string): Promise<string> {
    const data = this.erc20MetadataInterface.encodeFunctionData("symbol", []);
    const encoded = await this.rpc.call(this.address(token), data);
    return String(this.erc20MetadataInterface.decodeFunctionResult("symbol", encoded)[0]);
  }

  /** For native ETH the sentinel is displayed with fixed metadata. */
  async getAssetDisplay(owner: string, asset: string, rawBalance: bigint): Promise<TokenDisplay> {
    const address = this.address(asset);
    if (address === ETH_SENTINEL) {
      return { address, symbol: "ETH", decimals: 18, rawBalance, formattedBalance: formatUnits(rawBalance, 18) };
    }
    try {
      const [symbol, decimals] = await Promise.all([this.getTokenSymbol(address), this.getTokenDecimals(address)]);
      return { address, symbol, decimals, rawBalance, formattedBalance: formatUnits(rawBalance, decimals) };
    } catch {
      return { address, symbol: "TOKEN", decimals: 0, rawBalance, formattedBalance: rawBalance.toString() };
    }
  }

  async getTokenDisplay(owner: string, token: string, rawBalance: bigint): Promise<TokenDisplay> {
    return this.getAssetDisplay(owner, token, rawBalance);
  }

  async parseTokenAmount(token: string, amount: string): Promise<bigint> {
    if (!/^\d+(?:\.\d+)?$/.test(amount)) throw new Error("Token amount must be a positive decimal number");
    const decimals = await this.getTokenDecimals(token);
    const raw = parseUnits(amount, decimals);
    if (raw <= 0n) throw new Error("Token amount must be greater than zero");
    return raw;
  }

  formatTokenAmount(amount: bigint, decimals: number): string { return formatUnits(amount, decimals); }

  // ---- Prepare: owner actions (target the owner's instance) --------------
  // All instance-targeting prepares are async: the target vault address is
  // resolved through the factory's `vaultOf` registry first (a single RPC
  // call), because a per-owner instance has its own address.

  /** Create a vault via the factory (the only factory-targeting prepare). */
  prepareCreateVault(interval: bigint, maxMisses: number, accounts: string[], allocationsBps: number[], reserve = 0n) {
    return this.prepareFactory(
      "createVault",
      [interval, maxMisses, accounts.map((a) => this.address(a)), allocationsBps],
      reserve
    );
  }

  async prepareUpdateSettings(owner: string, interval: bigint, maxMisses: number) {
    return this.prepareInstanceAction(owner, "updateSettings", [interval, maxMisses]);
  }

  async prepareUpdateBeneficiaries(owner: string, accounts: string[], allocationsBps: number[]) {
    return this.prepareInstanceAction(owner, "updateBeneficiaries", [accounts.map((a) => this.address(a)), allocationsBps]);
  }

  async prepareCheckIn(owner: string) { return this.prepareInstanceAction(owner, "checkIn", []); }
  async prepareCloseVault(owner: string) { return this.prepareInstanceAction(owner, "closeVault", []); }
  async prepareDeposit(owner: string, token: string, amount: bigint) {
    return this.prepareInstanceAction(owner, "deposit", [this.address(token), amount]);
  }
  async prepareDepositETH(owner: string) { return this.prepareInstanceAction(owner, "depositETH", [], 0n); }
  async prepareWithdraw(owner: string, token: string, amount: bigint) {
    return this.prepareInstanceAction(owner, "withdraw", [this.address(token), amount]);
  }

  /** Top-up automation reserve: the native amount is carried in tx.value. */
  async prepareTopUpAutomationReserve(owner: string, amount: bigint) {
    return this.prepareInstanceAction(owner, "topUpAutomationReserve", [], amount);
  }
  async prepareWithdrawAutomationReserve(owner: string, amount: bigint) {
    return this.prepareInstanceAction(owner, "withdrawAutomationReserve", [amount]);
  }

  /** Approve the owner's vault instance to spend an ERC-20 on their behalf. */
  async prepareTokenApproval(owner: string, token: string, amount: bigint): Promise<PreparedTransaction> {
    if (amount <= 0n) throw new Error("Approval amount must be greater than zero");
    const instance = await this.resolveInstance(owner);
    return {
      chainId: this.chainId,
      to: this.address(token),
      data: this.erc20Interface.encodeFunctionData("approve", [instance, amount]),
      value: "0x0"
    };
  }

  // ---- Prepare: permissionless keeper/manager actions (target the instance) --

  async prepareTriggerInheritance(owner: string) { return this.prepareInstanceAction(owner, "triggerInheritance", []); }
  async prepareTokenDistribution(owner: string, asset: string) {
    return this.prepareInstanceAction(owner, "distributeInheritanceAsset", [this.address(asset)]);
  }
  async prepareDistributionRetry(owner: string, asset: string, beneficiary: string) {
    return this.prepareInstanceAction(
      owner,
      "retryInheritanceDistribution",
      [this.address(asset), this.address(beneficiary)]
    );
  }
  async prepareClaimAutomationReserve(owner: string) { return this.prepareInstanceAction(owner, "claimAutomationReserve", []); }

  // ---- Internal helpers -----------------------------------------------------

  private async resolveInstance(owner: string): Promise<string> {
    const vault = await this.discoverVault(owner);
    if (!vault) throw new Error(`No vault exists for owner ${owner}`);
    return vault;
  }

  private async instanceRead(owner: string, functionName: string, values: readonly unknown[]) {
    return this.callInstance(await this.resolveInstance(owner), functionName, values);
  }

  private async instanceOf(owner: string): Promise<string> {
    return this.resolveInstance(owner);
  }

  private async callInstance(instance: string, functionName: string, values: readonly unknown[]) {
    const data = this.instanceInterface.encodeFunctionData(functionName, values);
    const encoded = await this.rpc.call(instance, data);
    return this.instanceInterface.decodeFunctionResult(functionName, encoded);
  }

  private async callFactory(functionName: string, values: readonly unknown[]) {
    const data = this.factoryInterface.encodeFunctionData(functionName, values);
    const encoded = await this.rpc.call(this.factoryAddress, data);
    return this.factoryInterface.decodeFunctionResult(functionName, encoded);
  }

  private async prepareInstanceAction(
    owner: string,
    functionName: string,
    values: readonly unknown[],
    value = 0n
  ): Promise<PreparedTransaction> {
    const instance = await this.resolveInstance(owner);
    return {
      chainId: this.chainId,
      to: instance,
      data: this.instanceInterface.encodeFunctionData(functionName, values),
      value: toBeHex(value)
    };
  }

  private prepareFactory(functionName: string, values: readonly unknown[], value = 0n): PreparedTransaction {
    return {
      chainId: this.chainId,
      to: this.factoryAddress,
      data: this.factoryInterface.encodeFunctionData(functionName, values),
      value: toBeHex(value)
    };
  }

  private address(value: string): string { return getAddress(value); }
}