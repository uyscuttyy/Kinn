import type { JsonFileDocumentStore } from "./DocumentStore.js";
import type { AutomationCandidate, AutomationCandidateRepository } from "../automation/AutomationWorker.js";

const COLLECTION = "automation_candidates";

/**
 * Durable candidate registry (Phase 9): keeper candidates survive restarts and
 * can be managed (add/remove) instead of being hard-coded into the process env.
 */
export class DurableAutomationCandidateRepository implements AutomationCandidateRepository {
  constructor(private readonly store: JsonFileDocumentStore) {
    store.register(COLLECTION, "app_data", "Automation keeper candidates (deploymentKey + owner)");
  }

  async listCandidates(): Promise<AutomationCandidate[]> {
    const document = await this.store.load<{ candidates: AutomationCandidate[] }>(COLLECTION, { candidates: [] });
    return document.candidates;
  }

  async add(candidate: AutomationCandidate): Promise<void> {
    await this.store.update<{ candidates: AutomationCandidate[] }>(COLLECTION, { candidates: [] }, (document) => {
      const index = document.candidates.findIndex(
        (item) => item.deploymentKey === candidate.deploymentKey && item.owner.toLowerCase() === candidate.owner.toLowerCase()
      );
      if (index >= 0) document.candidates[index] = candidate;
      else document.candidates.push(candidate);
      return document;
    });
  }

  async remove(deploymentKey: string, owner: string): Promise<void> {
    await this.store.update<{ candidates: AutomationCandidate[] }>(COLLECTION, { candidates: [] }, (document) => {
      document.candidates = document.candidates.filter(
        (item) => !(item.deploymentKey === deploymentKey && item.owner.toLowerCase() === owner.toLowerCase())
      );
      return document;
    });
  }
}
