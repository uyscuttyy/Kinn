import { formatUnits, getAddress, Interface, parseUnits, toBeHex } from "ethers";
import { kinnAbi } from "../contracts/kinnAbi.js";
import type { BeneficiaryView, PreparedTransaction, TokenDisplay, VaultStatus, VaultView } from "../types.js";
import type { RpcClient } from "./RpcClient.js";

export class KinnContractService {
  readonly contractAddress: string;
  readonly chainId: number;
  readonly interface = new Interface(kinnAbi);
  private readonly erc20Interface = new Interface(["function approve(address spender,uint256 amount) returns (bool)"]);
  private readonly erc20MetadataInterface = new Interface([
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ]);

  constructor(private readonly rpc: RpcClient, contractAddress: string, chainId: number) {
    this.contractAddress = getAddress(contractAddress);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid chain ID");
    this.chainId = chainId;
  }

  async getVault(owner: string): Promise<VaultView> {
    const result = await this.read("getVault", [this.address(owner)]);
    const vault = result[0];
    return {
      owner: getAddress(vault.owner),
      lastCheckIn: vault.lastCheckIn,
      checkInInterval: vault.checkInInterval,
      maxMissedCheckIns: Number(vault.maxMissedCheckIns),
      active: vault.active,
      inheritanceTriggered: vault.inheritanceTriggered,
      automationReserve: vault.automationReserve
    };
  }

  async getBeneficiaries(owner: string): Promise<BeneficiaryView[]> {
    const result = await this.read("getBeneficiaries", [this.address(owner)]);
    return result[0].map((entry: { account: string; allocationBps: bigint }) => ({
      account: getAddress(entry.account),
      allocationBps: Number(entry.allocationBps)
    }));
  }

  async getTokenBalance(owner: string, token: string): Promise<bigint> {
    return (await this.read("getTokenBalance", [this.address(owner), this.address(token)]))[0];
  }

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

  async getTokenDisplay(owner: string, token: string, rawBalance: bigint): Promise<TokenDisplay> {
    const address = this.address(token);
    try {
      const [symbol, decimals] = await Promise.all([this.getTokenSymbol(address), this.getTokenDecimals(address)]);
      return { address, symbol, decimals, rawBalance, formattedBalance: formatUnits(rawBalance, decimals) };
    } catch {
      return { address, symbol: "TOKEN", decimals: 0, rawBalance, formattedBalance: rawBalance.toString() };
    }
  }

  async parseTokenAmount(token: string, amount: string): Promise<bigint> {
    if (!/^\d+(?:\.\d+)?$/.test(amount)) throw new Error("Token amount must be a positive decimal number");
    const decimals = await this.getTokenDecimals(token);
    const raw = parseUnits(amount, decimals);
    if (raw <= 0n) throw new Error("Token amount must be greater than zero");
    return raw;
  }

  formatTokenAmount(amount: bigint, decimals: number): string { return formatUnits(amount, decimals); }

  async isInheritanceTokenProcessed(owner: string, token: string): Promise<boolean> {
    return (await this.read("inheritanceTokenProcessed", [this.address(owner), this.address(token)]))[0];
  }

  async getPendingInheritance(owner: string, token: string, beneficiary: string): Promise<bigint> {
    return (await this.read("getPendingInheritance", [
      this.address(owner), this.address(token), this.address(beneficiary)
    ]))[0];
  }

  async getNextDistributionRetry(owner: string, token: string, beneficiary: string): Promise<bigint> {
    return (await this.read("getNextDistributionRetry", [
      this.address(owner), this.address(token), this.address(beneficiary)
    ]))[0];
  }

  async getVaultStatus(owner: string): Promise<VaultStatus> {
    const normalizedOwner = this.address(owner);
    const [vault, beneficiaries, tokenResult, nextResult, missedResult, eligibleResult] = await Promise.all([
      this.getVault(normalizedOwner),
      this.getBeneficiaries(normalizedOwner),
      this.read("getVaultTokens", [normalizedOwner]),
      this.read("nextExpectedCheckIn", [normalizedOwner]),
      this.read("missedCheckIns", [normalizedOwner]),
      this.read("inheritanceEligible", [normalizedOwner])
    ]);
    const tokens = (tokenResult[0] as string[]).map(getAddress);
    const balanceEntries = await Promise.all(
      tokens.map(async (token) => [token, await this.getTokenBalance(normalizedOwner, token)] as const)
    );
    return {
      vault,
      beneficiaries,
      tokens,
      balances: Object.fromEntries(balanceEntries),
      nextExpectedCheckIn: nextResult[0],
      missedCheckIns: Number(missedResult[0]),
      inheritanceEligible: eligibleResult[0]
    };
  }

  prepareCreateVault(interval: bigint, maxMisses: number, accounts: string[], allocationsBps: number[], reserve = 0n) {
    return this.prepare("createVault", [interval, maxMisses, accounts.map((a) => this.address(a)), allocationsBps], reserve);
  }

  prepareUpdateSettings(interval: bigint, maxMisses: number) {
    return this.prepare("updateSettings", [interval, maxMisses]);
  }

  prepareUpdateBeneficiaries(accounts: string[], allocationsBps: number[]) {
    return this.prepare("updateBeneficiaries", [accounts.map((a) => this.address(a)), allocationsBps]);
  }

  prepareTokenApproval(token: string, amount: bigint): PreparedTransaction {
    if (amount <= 0n) throw new Error("Approval amount must be greater than zero");
    return {
      chainId: this.chainId,
      to: this.address(token),
      data: this.erc20Interface.encodeFunctionData("approve", [this.contractAddress, amount]),
      value: "0x0"
    };
  }

  prepareDeposit(token: string, amount: bigint) { return this.prepare("deposit", [this.address(token), amount]); }
  prepareWithdraw(token: string, amount: bigint) { return this.prepare("withdraw", [this.address(token), amount]); }
  prepareCheckIn() { return this.prepare("checkIn", []); }
  prepareCloseVault() { return this.prepare("closeVault", []); }
  prepareTopUpAutomationReserve(amount: bigint) { return this.prepare("topUpAutomationReserve", [], amount); }
  prepareWithdrawAutomationReserve(amount: bigint) { return this.prepare("withdrawAutomationReserve", [amount]); }
  prepareClaimCompletedAutomationReserve(owner: string) {
    return this.prepare("claimCompletedAutomationReserve", [this.address(owner)]);
  }
  prepareTriggerInheritance(owner: string) { return this.prepare("triggerInheritance", [this.address(owner)]); }
  prepareTokenDistribution(owner: string, token: string) {
    return this.prepare("distributeInheritanceToken", [this.address(owner), this.address(token)]);
  }
  prepareDistributionRetry(owner: string, token: string, beneficiary: string) {
    return this.prepare("retryInheritanceDistribution", [
      this.address(owner), this.address(token), this.address(beneficiary)
    ]);
  }

  private async read(functionName: string, values: readonly unknown[]) {
    const data = this.interface.encodeFunctionData(functionName, values);
    const encoded = await this.rpc.call(this.contractAddress, data);
    return this.interface.decodeFunctionResult(functionName, encoded);
  }

  private prepare(functionName: string, values: readonly unknown[], value = 0n): PreparedTransaction {
    return {
      chainId: this.chainId,
      to: this.contractAddress,
      data: this.interface.encodeFunctionData(functionName, values),
      value: toBeHex(value)
    };
  }

  private address(value: string): string { return getAddress(value); }
}
