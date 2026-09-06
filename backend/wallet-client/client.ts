import EthereumProvider from "@walletconnect/ethereum-provider";

type RequestArguments = { method: string; params?: unknown[] };
type Eip1193Provider = { request(args: RequestArguments): Promise<any> };

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    KINN_WALLET_CONFIG?: { walletConnectProjectId?: string };
  }
}

const browserButton = document.querySelector<HTMLButtonElement>("#sign")!;
const walletConnectButton = document.querySelector<HTMLButtonElement>("#walletconnect")!;
const result = document.querySelector<HTMLPreElement>("#result")!;
const title = document.querySelector<HTMLElement>("#title")!;
const summary = document.querySelector<HTMLElement>("#summary")!;
const details = document.querySelector<HTMLElement>("#details")!;
const copy = document.querySelector<HTMLButtonElement>("#copy")!;
const explorer = document.querySelector<HTMLAnchorElement>("#explorer")!;
const projectId = window.KINN_WALLET_CONFIG?.walletConnectProjectId?.trim() ?? "";
let copyText = "";

const addDetail = (label: string, value: string) => {
  const row = document.createElement("div");
  row.className = "detail";
  row.innerHTML = "<span></span><span></span>";
  row.children[0]!.textContent = label;
  row.children[1]!.textContent = value;
  details.appendChild(row);
};
const show = (message: string, error = false) => {
  result.hidden = false;
  result.className = error ? "error" : "";
  result.textContent = message;
};
const copyValue = async (value: string) => {
  try { await navigator.clipboard.writeText(value); return true; } catch {
    const area = document.createElement("textarea");
    area.value = value; area.readOnly = true; area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.focus(); area.select();
    let copied = false; try { copied = document.execCommand("copy"); } catch {} area.remove(); return copied;
  }
};
const decode = () => {
  if (!location.hash.slice(1)) throw new Error("No Kinn signing request was provided.");
  const base64 = location.hash.slice(1).replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(decodeURIComponent(escape(atob(base64))));
};
const payload = decode();
const chainId = Number(payload.kind === "transaction" ? payload.transaction.chainId : payload.challenge.domain.chainId);
if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error("The signing request contains an invalid chain ID.");

if (payload.kind === "wallet_challenge") {
  title.textContent = "Kinn wallet verification";
  summary.textContent = "Sign a wallet ownership message. This signature cannot move funds.";
  browserButton.textContent = "Connect browser wallet and sign";
  details.hidden = false;
  addDetail("Network", payload.challenge.deploymentKey);
  addDetail("Wallet", payload.challenge.message.wallet);
  addDetail("Expires", new Date(Number(payload.challenge.message.expiresAt) * 1000).toLocaleString());
} else if (payload.kind === "transaction") {
  title.textContent = "Kinn transaction";
  summary.textContent = `Review and submit this Kinn transaction on chain ${chainId}.`;
  browserButton.textContent = "Review in browser wallet";
  details.hidden = false;
  addDetail("Network", `Chain ${chainId}`);
  addDetail("From", payload.transaction.from || "Connected account");
  addDetail("To", payload.transaction.to);
  addDetail("Value", payload.transaction.value || "0x0");
} else throw new Error("Unknown Kinn authorization request.");
if (projectId) walletConnectButton.hidden = false;

const waitForReceipt = async (provider: Eip1193Provider, txHash: string) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
    if (receipt) return receipt;
    show(`Transaction pending. Keep this page open.\n\n${txHash}`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  return null;
};

const authorize = async (provider: Eip1193Provider) => {
  if (payload.kind === "transaction") {
    const expectedChain = `0x${chainId.toString(16)}`;
    const currentChain = await provider.request({ method: "eth_chainId" });
    if (String(currentChain).toLowerCase() !== expectedChain.toLowerCase()) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: expectedChain }] });
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const account = accounts[0];
    if (!account || account.toLowerCase() !== payload.transaction.from.toLowerCase()) throw new Error(`The connected wallet does not match ${payload.transaction.from}.`);
    const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from: account, to: payload.transaction.to, data: payload.transaction.data, value: payload.transaction.value }] });
    if (payload.explorerTxBaseUrl) { explorer.href = `${payload.explorerTxBaseUrl.replace(/\/$/, "")}/${txHash}`; explorer.hidden = false; }
    browserButton.hidden = true; walletConnectButton.hidden = true;
    show(`Transaction submitted and waiting for confirmation.\n\n${txHash}`);
    const receipt = await waitForReceipt(provider, txHash);
    if (!receipt) { show(`Confirmation is taking longer than expected. The transaction may still confirm.\n\n${txHash}`); return; }
    const succeeded = BigInt(receipt.status) === 1n;
    let telegramNotified = false;
    if (succeeded && payload.callback) {
      try { const callbackResponse = await fetch("/api/transaction-result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callback: payload.callback, txHash }) }); telegramNotified = callbackResponse.ok; } catch {}
    }
    show(`${succeeded ? "Transaction confirmed." : "Transaction failed."}\n\nHash: ${txHash}\nBlock: ${BigInt(receipt.blockNumber)}${telegramNotified ? "\n\nTelegram has been notified." : "\n\nReturn to Telegram."}`, !succeeded);
    return;
  }
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const account = accounts[0];
  if (!account || account.toLowerCase() !== payload.challenge.message.wallet.toLowerCase()) throw new Error(`The connected wallet does not match ${payload.challenge.message.wallet}.`);
  const typedData = { domain: payload.challenge.domain, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...payload.challenge.types }, primaryType: payload.challenge.primaryType, message: payload.challenge.message };
  const signature = await provider.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typedData)] });
  const command = `/verify ${payload.challenge.message.nonce} ${signature}`;
  copyText = command; copy.hidden = false;
  const copied = await copyValue(command);
  show(`Signature created. Send this command to the Kinn Telegram bot:\n\n${command}${copied ? "\n\nCopied to clipboard." : "\n\nUse the Copy button or select the command manually."}`);
};

const run = async (button: HTMLButtonElement, providerFactory: () => Promise<Eip1193Provider>) => {
  browserButton.disabled = true; walletConnectButton.disabled = true;
  try { await authorize(await providerFactory()); } catch (error) { show(error instanceof Error ? error.message : String(error), true); }
  finally { button.disabled = false; browserButton.disabled = false; walletConnectButton.disabled = false; }
};
browserButton.addEventListener("click", () => run(browserButton, async () => {
  if (window.ethereum) return window.ethereum;
  throw new Error("No browser wallet was detected. Install a browser wallet or use WalletConnect.");
}));
walletConnectButton.addEventListener("click", () => run(walletConnectButton, async () => {
  if (!projectId) throw new Error("WalletConnect is not configured.");
  const provider = await EthereumProvider.init({ projectId, chains: [chainId], showQrModal: true, metadata: { name: "Kinn", description: "Authorize Kinn inheritance vault actions", url: location.origin, icons: [`${location.origin}/kinn-logo.jpg`] } });
  await provider.connect();
  return provider as Eip1193Provider;
}));
copy.addEventListener("click", async () => { const copied = await copyValue(copyText); show(copied ? "Verification command copied. Return to Telegram and send it." : "Select and copy the verification command above manually."); });
