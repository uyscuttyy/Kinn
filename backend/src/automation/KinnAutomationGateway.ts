import type { KinnContractService } from "../blockchain/KinnContractService.js";
import type { AutomationCandidate, AutomationGateway, AutomationVaultState, PendingDistribution } from "./AutomationWorker.js";

export class KinnAutomationGateway implements AutomationGateway {
  constructor(private readonly services: ReadonlyMap<string, KinnContractService>) {}

  async readState(candidate: AutomationCandidate): Promise<AutomationVaultState> {
    const service = this.service(candidate.deploymentKey);
    const status = await service.getVaultStatus(candidate.owner);
    const processedEntries = await Promise.all(
      status.tokens.map(async (token) => [token, await service.isInheritanceAssetProcessed(candidate.owner, token)] as const)
    );
    const pending: PendingDistribution[] = [];
    if (status.vault.inheritanceTriggered) {
      for (const asset of status.tokens) {
        for (const beneficiary of status.beneficiaries) {
          const [amount, nextRetryAt] = await Promise.all([
            service.getPendingInheritance(candidate.owner, asset, beneficiary.account),
            service.getNextDistributionRetry(candidate.owner, asset, beneficiary.account)
          ]);
          if (amount !== 0n) pending.push({ token: asset, beneficiary: beneficiary.account, amount, nextRetryAt });
        }
      }
    }
    return { status, processedTokens: Object.fromEntries(processedEntries), pendingDistributions: pending };
  }

  async prepareTrigger(candidate: AutomationCandidate) {
    return this.service(candidate.deploymentKey).prepareTriggerInheritance(candidate.owner);
  }

  async prepareTokenDistribution(candidate: AutomationCandidate, token: string) {
    return this.service(candidate.deploymentKey).prepareTokenDistribution(candidate.owner, token);
  }

  async prepareRetry(candidate: AutomationCandidate, pending: PendingDistribution) {
    return this.service(candidate.deploymentKey).prepareDistributionRetry(
      candidate.owner, pending.token, pending.beneficiary
    );
  }

  async prepareReserveClaim(candidate: AutomationCandidate) {
    return this.service(candidate.deploymentKey).prepareClaimAutomationReserve(candidate.owner);
  }

  private service(deploymentKey: string) {
    const service = this.services.get(deploymentKey);
    if (!service) throw new Error(`No contract service configured for deployment: ${deploymentKey}`);
    return service;
  }
}
