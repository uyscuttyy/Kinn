import type { KinnContractService } from "../blockchain/KinnContractService.js";
import type { AutomationCandidate, AutomationGateway, AutomationVaultState, PendingDistribution } from "./AutomationWorker.js";

export class KinnAutomationGateway implements AutomationGateway {
  constructor(private readonly services: ReadonlyMap<string, KinnContractService>) {}

  async readState(candidate: AutomationCandidate): Promise<AutomationVaultState> {
    const service = this.service(candidate.deploymentKey);
    const status = await service.getVaultStatus(candidate.owner);
    const processedEntries = await Promise.all(
      status.tokens.map(async (token) => [token, await service.isInheritanceTokenProcessed(candidate.owner, token)] as const)
    );
    const pending: PendingDistribution[] = [];
    if (status.vault.inheritanceTriggered) {
      for (const token of status.tokens) {
        for (const beneficiary of status.beneficiaries) {
          const [amount, nextRetryAt] = await Promise.all([
            service.getPendingInheritance(candidate.owner, token, beneficiary.account),
            service.getNextDistributionRetry(candidate.owner, token, beneficiary.account)
          ]);
          if (amount !== 0n) pending.push({ token, beneficiary: beneficiary.account, amount, nextRetryAt });
        }
      }
    }
    return { status, processedTokens: Object.fromEntries(processedEntries), pendingDistributions: pending };
  }

  prepareTrigger(candidate: AutomationCandidate) {
    return this.service(candidate.deploymentKey).prepareTriggerInheritance(candidate.owner);
  }

  prepareTokenDistribution(candidate: AutomationCandidate, token: string) {
    return this.service(candidate.deploymentKey).prepareTokenDistribution(candidate.owner, token);
  }

  prepareRetry(candidate: AutomationCandidate, pending: PendingDistribution) {
    return this.service(candidate.deploymentKey).prepareDistributionRetry(
      candidate.owner, pending.token, pending.beneficiary
    );
  }

  prepareReserveClaim(candidate: AutomationCandidate) {
    return this.service(candidate.deploymentKey).prepareClaimCompletedAutomationReserve(candidate.owner);
  }

  private service(deploymentKey: string) {
    const service = this.services.get(deploymentKey);
    if (!service) throw new Error(`No contract service configured for deployment: ${deploymentKey}`);
    return service;
  }
}
