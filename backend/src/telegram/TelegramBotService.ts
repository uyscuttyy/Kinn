import type { WalletSession } from "../auth/WalletAuthService.js";
import type { IntentInterpreter } from "../ai/OpenAiIntentInterpreter.js";
import type { ValidatedAiAction } from "../ai/intent.js";
import type { TelegramGateway, TelegramMessage, TelegramReminderControl, TelegramTransport } from "./types.js";

const HELP = `Kinn commands:
/connect <network> <wallet> — begin wallet verification
/verify <nonce> <signature> — finish wallet verification
/create <intervalSeconds> <maxMisses> <reserveWei> <address:bps>... — prepare vault creation
/vault — view your vault
/status — check-in and inheritance status
/beneficiaries — view allocations
/settings — view check-in settings
/updatesettings <intervalSeconds> <maxMisses> — prepare a settings update
/checkin — prepare a wallet-signed check-in
/approve <token> <amount> — approve Kinn to transfer a token
/deposit <token> <amount> — prepare a deposit
/withdraw <token> <amount> — prepare a withdrawal
/reserve — view automation reserve
/topupreserve <rawAmount> — prepare an automation reserve top-up
/withdrawreserve <rawAmount> — prepare an automation reserve withdrawal
/reminders <on|off|status> — manage check-in reminders
/help — show this help

Telegram never authorizes fund movement. Write actions always require your wallet signature.`;

export class TelegramBotService {
  private readonly sessions = new Map<string, WalletSession>();

  constructor(
    private readonly gateway: TelegramGateway,
    private readonly transport: TelegramTransport,
    private readonly ai?: IntentInterpreter,
    private readonly reminders?: TelegramReminderControl
  ) {}

  async handleMessage(message: TelegramMessage): Promise<void> {
    const text = message.text.trim();
    try {
      if (text.startsWith("/")) {
        await this.handleCommand(message, text);
      } else {
        await this.handleNaturalLanguage(message, text.toLowerCase());
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      await this.transport.sendMessage(message.chatId, `Kinn could not complete that request: ${detail}`);
    }
  }

  private async handleCommand(message: TelegramMessage, text: string) {
    const [command = "", ...args] = text.split(/\s+/);
    switch (command.toLowerCase()) {
      case "/start":
        await this.transport.sendMessage(
          message.chatId,
          "Welcome to Kinn. Your wallet remains in control of every vault action. Use /help to see available commands."
        );
        return;
      case "/help":
        await this.transport.sendMessage(message.chatId, HELP);
        return;
      case "/connect":
        await this.connect(message, args);
        return;
      case "/verify":
        await this.verify(message, args);
        return;
      case "/create":
        await this.createVault(message, args);
        return;
      case "/vault":
        await this.showVault(message);
        return;
      case "/status":
        await this.showStatus(message);
        return;
      case "/beneficiaries":
        await this.showBeneficiaries(message);
        return;
      case "/settings":
        await this.showSettings(message);
        return;
      case "/updatesettings":
        await this.updateSettings(message, args);
        return;
      case "/checkin":
        await this.prepare(message, { action: "check_in" }, "Check-in transaction prepared.");
        return;
      case "/approve": {
        if (args.length !== 2) throw new Error("Usage: /approve <token> <amount>");
        const amount = await this.tokenAmount(message, args[0] as string, args[1] as string);
        await this.prepare(
          message,
          { action: "approve_token", token: args[0] as string, amount },
          `Token approval prepared for ${amount} raw units. After it confirms, send /deposit with the same token and amount.`
        );
        return;
      }
      case "/deposit":
      case "/withdraw": {
        if (args.length !== 2) throw new Error(`Usage: ${command} <token> <amount>`);
        const amount = await this.tokenAmount(message, args[0] as string, args[1] as string);
        await this.prepare(
          message,
          { action: command === "/deposit" ? "deposit" : "withdraw", token: args[0] as string, amount },
          `${command === "/deposit" ? "Deposit" : "Withdrawal"} transaction prepared.`
        );
        return;
      }
      case "/reserve": {
        const { status } = await this.status(message);
        await this.transport.sendMessage(message.chatId, `Automation reserve: ${status.vault.automationReserve} wei`);
        return;
      }
      case "/reminders":
        await this.reminderCommand(message, args);
        return;
      case "/topupreserve":
      case "/withdrawreserve": {
        if (args.length !== 1) throw new Error(`Usage: ${command} <rawNativeAmount>`);
        const amount = this.positiveAmount(args[0] as string);
        await this.prepare(
          message,
          { action: command === "/topupreserve" ? "top_up_automation_reserve" : "withdraw_automation_reserve", amount },
          `${command === "/topupreserve" ? "Automation reserve top-up" : "Automation reserve withdrawal"} prepared.`
        );
        return;
      }
      default:
        await this.transport.sendMessage(message.chatId, "Unknown command. Use /help to see Kinn commands.");
    }
  }

  private async connect(message: TelegramMessage, args: string[]) {
    if (args.length !== 2) {
      const networks = this.gateway.listDeployments().map((item) => `${item.key} (${item.chainId})`).join(", ");
      throw new Error(`Usage: /connect <network> <wallet>. Available: ${networks}`);
    }
    const challenge = this.gateway.createWalletChallenge(args[0] as string, message.telegramUserId, args[1] as string);
    await this.transport.sendMessage(
      message.chatId,
      `Sign this EIP-712 wallet challenge, then send /verify <nonce> <signature>.\n\nNonce: ${challenge.message.nonce}\nNetwork: ${challenge.deploymentKey}\nExpires: ${challenge.message.expiresAt}`,
      { walletChallenge: challenge }
    );
  }

  private async verify(message: TelegramMessage, args: string[]) {
    if (args.length !== 2) throw new Error("Usage: /verify <nonce> <signature>");
    const session = await this.gateway.verifyWalletChallenge(args[0] as string, args[1] as string);
    if (session.telegramUserId !== message.telegramUserId) throw new Error("Challenge belongs to another Telegram user");
    this.sessions.set(this.sessionKey(message), session);
    await this.transport.sendMessage(
      message.chatId,
      `Wallet connected: ${session.wallet}\nNetwork: ${session.deploymentKey}`
    );
  }

  private async createVault(message: TelegramMessage, args: string[]) {
    if (args.length < 4) {
      throw new Error("Usage: /create <intervalSeconds> <maxMisses> <reserveWei> <address:bps>...");
    }
    const interval = this.positiveAmount(args[0] as string);
    if (interval > 9n * 7n * 24n * 60n * 60n) throw new Error("Check-in interval cannot exceed 9 weeks");
    const maxMisses = Number(args[1]);
    if (!Number.isInteger(maxMisses) || maxMisses < 1 || maxMisses > 5) {
      throw new Error("Maximum missed check-ins must be between 1 and 5");
    }
    const reserve = BigInt(args[2] as string);
    if (reserve < 0n) throw new Error("Automation reserve cannot be negative");
    const beneficiaryEntries = args.slice(3).map((entry) => {
      const separator = entry.lastIndexOf(":");
      if (separator <= 0) throw new Error(`Invalid beneficiary allocation: ${entry}`);
      const account = entry.slice(0, separator);
      const allocationBps = Number(entry.slice(separator + 1));
      if (!Number.isInteger(allocationBps) || allocationBps <= 0 || allocationBps > 10_000) {
        throw new Error(`Invalid beneficiary allocation: ${entry}`);
      }
      return { account, allocationBps };
    });
    const total = beneficiaryEntries.reduce((sum, entry) => sum + entry.allocationBps, 0);
    if (total !== 10_000) throw new Error(`Beneficiary allocations must total 10000 BPS; received ${total}`);
    await this.prepare(
      message,
      {
        action: "create_vault",
        interval,
        maxMisses,
        reserve,
        accounts: beneficiaryEntries.map(({ account }) => account),
        allocationsBps: beneficiaryEntries.map(({ allocationBps }) => allocationBps)
      },
      `Vault creation prepared with ${beneficiaryEntries.length} beneficiary allocation(s).`
    );
  }

  private async updateSettings(message: TelegramMessage, args: string[]) {
    if (args.length !== 2) throw new Error("Usage: /updatesettings <intervalSeconds> <maxMisses>");
    const interval = this.positiveAmount(args[0] as string);
    if (interval > 9n * 7n * 24n * 60n * 60n) throw new Error("Check-in interval cannot exceed 9 weeks");
    const maxMisses = Number(args[1]);
    if (!Number.isInteger(maxMisses) || maxMisses < 1 || maxMisses > 5) {
      throw new Error("Maximum missed check-ins must be between 1 and 5");
    }
    await this.prepare(
      message,
      { action: "update_settings", interval, maxMisses },
      `Settings update prepared: check in every ${interval} seconds, maximum ${maxMisses} missed check-in${maxMisses === 1 ? "" : "s"}.`
    );
  }

  private async reminderCommand(message: TelegramMessage, args: string[]) {
    if (!this.reminders) throw new Error("Reminder service is not configured");
    if (args.length !== 1 || !["on", "off", "status"].includes((args[0] ?? "").toLowerCase())) {
      throw new Error("Usage: /reminders <on|off|status>");
    }
    const session = this.requireSession(message);
    const action = (args[0] as string).toLowerCase();
    if (action === "on") {
      await this.reminders.enable(message.chatId, message.telegramUserId, session.deploymentKey, session.wallet);
      await this.transport.sendMessage(message.chatId, "Kinn reminders are enabled for this wallet and network.");
      return;
    }
    if (action === "off") {
      await this.reminders.disable(message.telegramUserId, session.deploymentKey);
      await this.transport.sendMessage(message.chatId, "Kinn reminders are disabled for this wallet and network.");
      return;
    }
    const enabled = await this.reminders.status(message.telegramUserId, session.deploymentKey);
    await this.transport.sendMessage(message.chatId, `Kinn reminders: ${enabled ? "enabled" : "disabled"}.`);
  }

  private async showVault(message: TelegramMessage) {
    const { session, status } = await this.status(message);
    const displays = await Promise.all(status.tokens.map((token) =>
      this.gateway.getTokenDisplay(session.deploymentKey, session.wallet, token, status.balances[token] ?? 0n)
    ));
    const balances = displays.length
      ? displays.map((token) => `${token.formattedBalance} ${token.symbol}\n${token.address}`).join("\n\n")
      : "No deposited assets";
    await this.transport.sendMessage(
      message.chatId,
      `Vault: ${session.wallet}\nActive: ${status.vault.active}\nInheritance triggered: ${status.vault.inheritanceTriggered}\n\nAssets:\n${balances}`
    );
  }

  private async showStatus(message: TelegramMessage) {
    const { status } = await this.status(message);
    const now = Math.floor(Date.now() / 1000);
    await this.transport.sendMessage(
      message.chatId,
      `Last check-in: ${this.timestamp(status.vault.lastCheckIn)}\n` +
      `Next expected: ${this.timestamp(status.nextExpectedCheckIn)} (${this.relativeTime(Number(status.nextExpectedCheckIn) - now)})\n` +
      `Missed: ${status.missedCheckIns}/${status.vault.maxMissedCheckIns}\n` +
      `Inheritance eligible: ${status.inheritanceEligible}`
    );
  }

  private async showBeneficiaries(message: TelegramMessage) {
    const { status } = await this.status(message);
    const lines = status.beneficiaries.map(
      (beneficiary) => `${beneficiary.account}: ${(beneficiary.allocationBps / 100).toFixed(2)}%`
    );
    await this.transport.sendMessage(message.chatId, `Beneficiaries:\n${lines.join("\n")}`);
  }

  private async showSettings(message: TelegramMessage) {
    const { status } = await this.status(message);
    await this.transport.sendMessage(
      message.chatId,
      `Check-in interval: ${status.vault.checkInInterval} seconds\nMaximum missed check-ins: ${status.vault.maxMissedCheckIns}`
    );
  }

  private async prepare(
    message: TelegramMessage,
    request: Parameters<TelegramGateway["prepareOwnerTransaction"]>[2],
    confirmation: string
  ) {
    const session = this.requireSession(message);
    const transaction = this.gateway.prepareOwnerTransaction(session.token, session.deploymentKey, request);
    await this.transport.sendMessage(
      message.chatId,
      `${confirmation}\nA wallet signature is required. Review the network, contract, and calldata before signing.`,
      { signingRequest: transaction }
    );
  }

  private async status(message: TelegramMessage) {
    const session = this.requireSession(message);
    return {
      session,
      status: await this.gateway.getVaultStatus(session.deploymentKey, session.wallet)
    };
  }

  private requireSession(message: TelegramMessage): WalletSession {
    const session = this.sessions.get(this.sessionKey(message));
    if (!session) throw new Error("Connect and verify your wallet first with /connect");
    return session;
  }

  private sessionKey(message: TelegramMessage): string {
    return `${message.chatId}:${message.telegramUserId}`;
  }

  private positiveAmount(value: string): bigint {
    const amount = BigInt(value);
    if (amount <= 0n) throw new Error("Amount must be greater than zero");
    return amount;
  }

  private async tokenAmount(message: TelegramMessage, token: string, humanAmount: string): Promise<bigint> {
    const session = this.requireSession(message);
    return this.gateway.parseTokenAmount(session.deploymentKey, token, humanAmount);
  }

  private timestamp(value: bigint): string {
    const seconds = Number(value);
    return `${new Date(seconds * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC")} (${value})`;
  }

  private relativeTime(seconds: number): string {
    const absolute = Math.abs(seconds);
    const units: [number, string][] = [[86400, "day"], [3600, "hour"], [60, "minute"]];
    const [size, label] = units.find(([size]) => absolute >= size) ?? [1, "second"];
    const count = Math.max(1, Math.floor(absolute / size));
    return seconds >= 0
      ? `in ${count} ${label}${count === 1 ? "" : "s"}`
      : `${count} ${label}${count === 1 ? "" : "s"} overdue`;
  }

  private async handleNaturalLanguage(message: TelegramMessage, text: string) {
    if (this.ai) {
      const action = await this.ai.interpret(text, "The user is interacting through the Kinn Telegram interface.");
      await this.dispatchAiAction(message, action);
      return;
    }
    if (text.includes("when") && text.includes("check in")) return this.showStatus(message);
    if (text.includes("beneficiar")) return this.showBeneficiaries(message);
    if (text.includes("check me in")) return this.prepare(message, { action: "check_in" }, "Check-in prepared.");
    if (text.includes("vault") || text.includes("balance")) return this.showVault(message);
    await this.transport.sendMessage(
      message.chatId,
      "I can understand basic Kinn status requests now. Use /help for actions. Full conversational AI arrives in the next phase."
    );
  }

  private async dispatchAiAction(message: TelegramMessage, action: ValidatedAiAction) {
    switch (action.action) {
      case "read_vault": return this.showVault(message);
      case "read_status": return this.showStatus(message);
      case "read_beneficiaries": return this.showBeneficiaries(message);
      case "read_settings": return this.showSettings(message);
      case "clarification":
        await this.transport.sendMessage(message.chatId, action.message);
        return;
      case "check_in": return this.prepare(message, action, "AI interpreted your request as a check-in.");
      case "deposit": return this.prepare(message, action, `AI prepared a deposit of ${action.amount} raw token units.`);
      case "withdraw": return this.prepare(message, action, `AI prepared a withdrawal of ${action.amount} raw token units.`);
      case "update_settings":
        return this.prepare(message, action, `AI prepared settings: interval ${action.interval}s, maximum misses ${action.maxMisses}.`);
      case "update_beneficiaries":
        return this.prepare(message, action, `AI prepared ${action.accounts.length} beneficiary allocation(s).`);
      case "create_vault":
        return this.prepare(message, action, `AI prepared a new vault with ${action.accounts.length} beneficiary allocation(s).`);
    }
  }
}
