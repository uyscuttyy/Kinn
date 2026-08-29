import type { KinnContractService } from "../blockchain/KinnContractService.js";
import type { PreparedTransaction, TokenDisplay, VaultStatus } from "../types.js";

export type PrepareAction =
  | { action: "create_vault"; interval: bigint; maxMisses: number; accounts: string[]; allocationsBps: number[]; reserve?: bigint }
  | { action: "update_settings"; owner: string; interval: bigint; maxMisses: number }
  | { action: "update_beneficiaries"; owner: string; accounts: string[]; allocationsBps: number[] }
  | { action: "approve_token"; owner: string; token: string; amount: bigint }
  | { action: "deposit"; owner: string; token: string; amount: bigint }
  | { action: "withdraw"; owner: string; token: string; amount: bigint }
  | { action: "check_in"; owner: string }
  | { action: "close_vault"; owner: string }
  | { action: "top_up_automation_reserve"; owner: string; amount: bigint }
  | { action: "withdraw_automation_reserve"; owner: string; amount: bigint }
  | { action: "trigger_inheritance"; owner: string }
  | { action: "distribute_token"; owner: string; token: string }
  | { action: "retry_distribution"; owner: string; token: string; beneficiary: string };

export class KinnApi {
  constructor(private readonly contract: KinnContractService) {}

  getVaultStatus(owner: string): Promise<VaultStatus> {
    return this.contract.getVaultStatus(owner);
  }

  getTokenDecimals(token: string): Promise<number> { return this.contract.getTokenDecimals(token); }
  parseTokenAmount(token: string, amount: string): Promise<bigint> { return this.contract.parseTokenAmount(token, amount); }
  getTokenDisplay(owner: string, token: string, rawBalance: bigint): Promise<TokenDisplay> {
    return this.contract.getTokenDisplay(owner, token, rawBalance);
  }

  async prepareTransaction(request: PrepareAction): Promise<PreparedTransaction> {
    switch (request.action) {
      case "create_vault":
        return this.contract.prepareCreateVault(
          request.interval, request.maxMisses, request.accounts, request.allocationsBps, request.reserve
        );
      case "update_settings":
        return this.contract.prepareUpdateSettings(request.owner, request.interval, request.maxMisses);
      case "update_beneficiaries":
        return this.contract.prepareUpdateBeneficiaries(request.owner, request.accounts, request.allocationsBps);
      case "approve_token":
        return this.contract.prepareTokenApproval(request.owner, request.token, request.amount);
      case "deposit":
        return this.contract.prepareDeposit(request.owner, request.token, request.amount);
      case "withdraw":
        return this.contract.prepareWithdraw(request.owner, request.token, request.amount);
      case "check_in":
        return this.contract.prepareCheckIn(request.owner);
      case "close_vault":
        return this.contract.prepareCloseVault(request.owner);
      case "top_up_automation_reserve":
        return this.contract.prepareTopUpAutomationReserve(request.owner, request.amount);
      case "withdraw_automation_reserve":
        return this.contract.prepareWithdrawAutomationReserve(request.owner, request.amount);
      case "trigger_inheritance":
        return this.contract.prepareTriggerInheritance(request.owner);
      case "distribute_token":
        return this.contract.prepareTokenDistribution(request.owner, request.token);
      case "retry_distribution":
        return this.contract.prepareDistributionRetry(request.owner, request.token, request.beneficiary);
    }
  }
}
