import { EthersRpcClient } from "../blockchain/RpcClient.js";
import { KinnContractService } from "../blockchain/KinnContractService.js";
import { KinnApi } from "../api/KinnApi.js";
import { loadNetworkConfigs } from "../deployments/loadNetworkConfigs.js";
import { TelegramHttpTransport } from "../telegram/TelegramHttpTransport.js";
import { FileReminderRepository } from "./FileReminderRepository.js";
import { ReminderService } from "./ReminderService.js";
import { MultiNetworkReminderStatusReader, TelegramReminderNotifier } from "./TelegramReminderAdapter.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
const intervalMs = Number(process.env.KINN_REMINDER_INTERVAL_MS ?? "60000");
if (!Number.isSafeInteger(intervalMs) || intervalMs < 5000) throw new Error("KINN_REMINDER_INTERVAL_MS must be at least 5000");

const apis = new Map<string, KinnApi>();
for (const config of loadNetworkConfigs()) {
  apis.set(config.key, new KinnApi(new KinnContractService(new EthersRpcClient(config.rpcUrl), config.contractAddress, config.chainId)));
}
const repository = new FileReminderRepository(process.env.KINN_REMINDER_STORE ?? "data/reminders.json");
const service = new ReminderService(
  repository,
  repository,
  new MultiNetworkReminderStatusReader(apis),
  new TelegramReminderNotifier(new TelegramHttpTransport(token))
);

let stopped = false;
process.once("SIGINT", () => { stopped = true; });
process.once("SIGTERM", () => { stopped = true; });
console.log(`Kinn reminder worker started; interval ${intervalMs} ms`);
while (!stopped) {
  const result = await service.runOnce();
  console.log(`Reminder scan: checked=${result.checked} sent=${result.sent} failures=${result.failures}`);
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
