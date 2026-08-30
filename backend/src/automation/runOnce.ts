import { getAddress } from "ethers";
import { EthersRpcClient } from "../blockchain/RpcClient.js";
import { KinnContractService } from "../blockchain/KinnContractService.js";
import { loadNetworkConfigs } from "../deployments/loadNetworkConfigs.js";
import { TelegramHttpTransport } from "../telegram/TelegramHttpTransport.js";
import {
  AutomationWorker,
  InMemoryAutomationCandidateRepository,
  type AutomationCandidate
} from "./AutomationWorker.js";
import { ManagedRelayerSubmitter } from "./ManagedRelayerSubmitter.js";
import { createRelayerSignerProvider } from "./createRelayerSignerProvider.js";
import { DurableAutomationRecordRepository } from "../db/DurableAutomationRecordRepository.js";
import { DurableReminderRepository } from "../db/DurableReminderRepository.js";
import { createDocumentStore } from "../db/createDocumentStore.js";
import { KinnAutomationGateway } from "./KinnAutomationGateway.js";
import { TelegramAutomationNotifier } from "./TelegramAutomationNotifier.js";

const rawCandidates = process.env.KINN_AUTOMATION_CANDIDATES;
if (!rawCandidates) throw new Error("KINN_AUTOMATION_CANDIDATES is required (network:owner,network:owner)");
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

const candidates: AutomationCandidate[] = rawCandidates.split(",").map((entry, index) => {
  const separator = entry.lastIndexOf(":");
  if (separator <= 0) throw new Error(`Invalid automation candidate: ${entry}`);
  const deploymentKey = entry.slice(0, separator).trim();
  const owner = getAddress(entry.slice(separator + 1).trim());
  return { id: `${deploymentKey}:${owner}:${index}`, deploymentKey, owner };
});

const networkConfigs = loadNetworkConfigs();
const services = new Map<string, KinnContractService>();
for (const config of networkConfigs) {
  services.set(config.key, new KinnContractService(new EthersRpcClient(config.rpcUrl), config.contractAddress, config.chainId));
}
for (const candidate of candidates) {
  if (!services.has(candidate.deploymentKey)) throw new Error(`Candidate uses unknown deployment: ${candidate.deploymentKey}`);
}

// Managed signer (ARCHITECTURE §14): key material never enters this process
// unless the legacy env fallback is explicitly used, and even then it is
// unreachable from the submission surface.
const relayer = createRelayerSignerProvider(process.env, networkConfigs);
for (const [deploymentKey, address] of relayer.addresses) {
  console.log(`Relayer for ${deploymentKey} (${relayer.mode}): ${address}`);
}

const documentStore = createDocumentStore();
const reminderRepository = new DurableReminderRepository(documentStore);
const worker = new AutomationWorker(
  new InMemoryAutomationCandidateRepository(candidates),
  new KinnAutomationGateway(services),
  new ManagedRelayerSubmitter(relayer.provider),
  new DurableAutomationRecordRepository(documentStore),
  new TelegramAutomationNotifier(reminderRepository, new TelegramHttpTransport(token))
);

const result = await worker.runOnce();
console.log(`Automation run complete: checked=${result.checked} submitted=${result.submitted} failed=${result.failed}`);
if (result.failed > 0) process.exitCode = 1;
