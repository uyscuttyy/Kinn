import { EthersRpcClient } from "../blockchain/RpcClient.js";
import { KinnContractService } from "../blockchain/KinnContractService.js";
import { KinnApi } from "../api/KinnApi.js";
import { AuthenticatedKinnApi } from "../api/AuthenticatedKinnApi.js";
import { WalletAuthService, InMemoryWalletAssociationRepository } from "../auth/WalletAuthService.js";
import { DeploymentRegistry } from "../deployments/DeploymentRegistry.js";
import { OpenAiIntentInterpreter } from "../ai/OpenAiIntentInterpreter.js";
import { KinnTelegramGateway } from "./KinnTelegramGateway.js";
import { TelegramBotService } from "./TelegramBotService.js";
import { TelegramHttpTransport, TelegramPollingClient } from "./TelegramHttpTransport.js";
import { getAddress } from "ethers";
import { loadNetworkConfigs } from "../deployments/loadNetworkConfigs.js";
import { DurableReminderRepository } from "../db/DurableReminderRepository.js";
import { createDocumentStore } from "../db/createDocumentStore.js";
import { RepositoryTelegramReminderControl } from "../reminders/TelegramReminderControl.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const token = required("TELEGRAM_BOT_TOKEN");
const networkConfigs = loadNetworkConfigs();
const deployments = new DeploymentRegistry(networkConfigs.map(({ key, chainId, contractAddress }) => ({ key, chainId, contractAddress })));
const apis = new Map<string, KinnApi>();
for (const config of networkConfigs) {
  const rpc = new EthersRpcClient(config.rpcUrl);
  apis.set(config.key, new KinnApi(new KinnContractService(rpc, config.contractAddress, config.chainId)));
}
const auth = new WalletAuthService(deployments, new InMemoryWalletAssociationRepository());
const authenticatedApi = new AuthenticatedKinnApi(apis, auth);
const gateway = new KinnTelegramGateway(deployments, auth, authenticatedApi, apis);
const transport = new TelegramHttpTransport(token);
const aiEnabled = process.env.KINN_AI_ENABLED?.toLowerCase() !== "false";
const ai = aiEnabled && process.env.OPENAI_API_KEY && process.env.KINN_OPENAI_MODEL
  ? new OpenAiIntentInterpreter(
      process.env.KINN_OPENAI_MODEL,
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_BASE_URL
    )
  : undefined;
const reminderRepository = new DurableReminderRepository(createDocumentStore());
const reminderControl = new RepositoryTelegramReminderControl(reminderRepository);
const bot = new TelegramBotService(gateway, transport, ai, reminderControl);
const polling = new TelegramPollingClient(token, (message) => bot.handleMessage(message));

process.once("SIGINT", () => polling.stop());
process.once("SIGTERM", () => polling.stop());
console.log(`Kinn Telegram polling started for networks: ${networkConfigs.map(({ key, chainId }) => `${key} (${chainId})`).join(", ")}`);
console.log(`AI intent parsing: ${ai ? "enabled" : "disabled"}`);
await polling.run();
