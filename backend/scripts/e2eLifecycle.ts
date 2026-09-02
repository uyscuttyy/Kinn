/**
 * Phase 11 — End-to-end lifecycle runner against a live testnet (Base Sepolia).
 *
 * Drives the full Kinn lifecycle through real on-chain transactions using the
 * already-deployed VaultFactory:
 *
 *   preflight -> test token -> createVault -> reserve top-up -> deposits
 *   -> check-in -> wait for on-chain eligibility -> trigger (keeper)
 *   -> duplicate-trigger rejection -> distribute (keeper) -> verify receipts
 *   -> claim reserve -> summary
 *
 * Owner actions are signed by the owner EOA (never the backend); keeper actions
 * (trigger/distribute/retry/claim) are signed by the relayer EOA to prove the
 * permissionless path. Every transaction hash is printed as evidence.
 *
 * The runner is resumable: each step checks live chain state and is skipped if
 * already completed, so it can be re-run while waiting for the (real-time)
 * check-in interval to elapse. Beneficiaries and the test-token address are
 * persisted in `.e2e-state.json` so resumes stay consistent.
 *
 * Usage:
 *   node --env-file=.env --import tsx backend/scripts/e2eLifecycle.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Provider,
  Wallet,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits
} from "ethers";
import { factoryAbi } from "../src/contracts/factoryAbi.js";
import { ETH_SENTINEL, inheritanceStateName, vaultAbi } from "../src/contracts/vaultAbi.js";

// ---- Configuration --------------------------------------------------------

const rpcUrl = process.env.KINN_BASE_SEPOLIA_RPC_URL ?? process.env.KINN_RPC_URL;
const chainId = Number(process.env.KINN_BASE_SEPOLIA_CHAIN_ID ?? process.env.KINN_CHAIN_ID ?? "0");
const factoryAddress = process.env.KINN_BASE_SEPOLIA_CONTRACT_ADDRESS ?? process.env.KINN_CONTRACT_ADDRESS;
const stateFile = new URL("../../.e2e-state.json", import.meta.url).pathname;

const CHECK_IN_INTERVAL_SECONDS = Number(process.env.KINN_E2E_CHECK_IN_INTERVAL_SECONDS ?? "300");
const MAX_MISSED_CHECK_INS = 1;
const TOKEN_DEPOSIT_AMOUNT = process.env.KINN_E2E_TOKEN_AMOUNT ?? "10"; // whole token units
const ETH_DEPOSIT_WEI = parseEther(process.env.KINN_E2E_ETH_DEPOSIT ?? "0.00005");
const RESERVE_TOPUP_WEI = parseEther(process.env.KINN_E2E_RESERVE_ETH ?? "0.00005");

type Evidence = { step: string; txHash?: string; detail: string };
const evidence: Evidence[] = [];
function record(step: string, detail: string, txHash?: string): void {
  evidence.push({ step, detail, txHash });
  const hash = txHash ? ` tx=${txHash}` : "";
  console.log(`  [${step}] ${detail}${hash}`);
}

// ---- Retry helper for flaky public RPC endpoints ---------------------------

// ---- Persistence (beneficiaries / token across resumes) --------------------

type E2eState = { beneficiaryKeys: string[]; tokenAddress?: string; checkInDone?: string };
function loadState(): E2eState {
  if (existsSync(stateFile)) return JSON.parse(readFileSync(stateFile, "utf8")) as E2eState;
  return { beneficiaryKeys: [] };
}
function saveState(state: E2eState): void {
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

// ---- Small utilities -------------------------------------------------------

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const delay = attempt * 3_000;
        console.log(`  (${label} attempt ${attempt} failed, retrying in ${delay / 1000}s)`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ethers v6 resolves ABI methods dynamically at runtime, but its static typing
 * only exposes them when using TypeChain-generated classes. This script uses
 * human-readable ABIs, so method access goes through this explicit type, where
 * both ABI methods and `.connect()` results are dynamic.
 */
interface DynamicContract {
  connect(signer: Wallet | Provider): DynamicContract;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ABI surface
  [method: string]: any;
}
function dynContract(contract: Contract): DynamicContract {
  return contract as unknown as DynamicContract;
}

async function send(label: string, tx: Promise<{ hash: string; wait: (c?: number) => Promise<unknown> }>): Promise<string> {
  const receipt = await withRetry(label, async () => {
    const response = await tx;
    await response.wait(1);
    return response;
  });
  record(label, "confirmed", receipt.hash);
  // Public RPC nodes can serve stale state right after a confirmed tx; let the
  // node settle before any dependent reads.
  await sleep(3_000);
  return receipt.hash;
}

/** Chain-state read with retry (public RPC nodes occasionally return empty data). */
async function readWithRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return withRetry(label, fn, 5);
}


// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  if (!rpcUrl || !factoryAddress || !chainId) {
    throw new Error(
      "Missing config: set KINN_BASE_SEPOLIA_RPC_URL, KINN_BASE_SEPOLIA_CHAIN_ID and KINN_BASE_SEPOLIA_CONTRACT_ADDRESS"
    );
  }
  const ownerKey = process.env.KINN_E2E_OWNER_PRIVATE_KEY ?? process.env.KINN_DEPLOYER_PRIVATE_KEY;
  const keeperKey = process.env.KINN_E2E_KEEPER_PRIVATE_KEY ?? process.env.KINN_RELAYER_PRIVATE_KEY;
  if (!ownerKey || !keeperKey) throw new Error("Missing KINN_DEPLOYER_PRIVATE_KEY / KINN_RELAYER_PRIVATE_KEY");

  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const owner = new Wallet(ownerKey, provider);
  const keeper = new Wallet(keeperKey, provider);
  const state = loadState();

  console.log(`Kinn E2E — chain ${chainId}, factory ${factoryAddress}`);
  console.log(`owner=${owner.address} keeper=${keeper.address}\n`);

  // ---- 1. Preflight --------------------------------------------------------
  const netId = Number(await withRetry("chainId", () => provider.send("eth_chainId", [])));
  if (netId !== chainId) throw new Error(`RPC chain ${netId} != expected ${chainId}`);
  const factory = dynContract(new Contract(factoryAddress, factoryAbi, provider));
  const code = await withRetry("getCode", () => provider.getCode(factoryAddress));
  if (code === "0x") throw new Error(`No contract at factory ${factoryAddress}`);
  const automationFee: bigint = await factory.automationFeeWei();
  const ownerBalance = await provider.getBalance(owner.address);
  const keeperBalance = await provider.getBalance(keeper.address);
  console.log(
    `preflight ok — automationFee=${formatEther(automationFee)} ETH, ` +
      `owner balance=${formatEther(ownerBalance)} ETH, keeper balance=${formatEther(keeperBalance)} ETH`
  );
  // Gas on Base is ~0.006 gwei, so small dust balances cover the whole
  // lifecycle; these gates only catch a genuinely unfunded wallet.
  if (ownerBalance < parseEther("0.0001") || keeperBalance < parseEther("0.000003")) {
    throw new Error(
      "FUNDING_REQUIRED — fund owner (>=0.0001 ETH) and keeper (>=0.000003 ETH) on this testnet, then re-run"
    );
  }

  // ---- 2. Test token -------------------------------------------------------
  let tokenAddress = state.tokenAddress ?? process.env.KINN_TEST_RWA_ADDRESS;
  let token: DynamicContract;
  if (!tokenAddress || (await provider.getCode(tokenAddress)) === "0x") {
    const artifact = JSON.parse(
      readFileSync(new URL("../../out/TestRwaToken.sol/TestRwaToken.json", import.meta.url).pathname, "utf8")
    );
    const factoryOfToken = new ContractFactory(artifact.abi, artifact.bytecode, owner);
    const deployed = await withRetry("token:deploy", async () => {
      const pending = await factoryOfToken.deploy("Kinn E2E RWA", "KE2E", 18);
      await pending.waitForDeployment();
      return pending;
    });
    tokenAddress = await deployed.getAddress();
    record("token:deploy", tokenAddress, deployed.deploymentTransaction()?.hash);
    state.tokenAddress = tokenAddress;
    saveState(state);
  }
  token = dynContract(
    new Contract(
      tokenAddress,
      [
        "function mint(address to,uint256 amount) external",
        "function approve(address spender,uint256 amount) returns (bool)",
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)"
      ],
      provider
    )
  );
  const decimals: number = await readWithRetry("decimals", () => token.decimals());
  const depositAmount = parseUnits(TOKEN_DEPOSIT_AMOUNT, decimals);
  if ((await readWithRetry<bigint>("tokenBalance", () => token.balanceOf(owner.address))) < depositAmount) {
    await send("token:mint", token.connect(owner).mint(owner.address, depositAmount * 2n));
  }
  console.log(`token ${tokenAddress} (decimals=${decimals})\n`);
  record("token:address", tokenAddress);

  // ---- 4. Vault ------------------------------------------------------------
  let vaultAddress: string = await readWithRetry("vaultOf", () => factory.vaultOf(owner.address));
  if (vaultAddress === "0x0000000000000000000000000000000000000000") {
    if (state.beneficiaryKeys.length === 0) {
      state.beneficiaryKeys = [randomBytes(32), randomBytes(32)].map((b) => `0x${b.toString("hex")}`);
      saveState(state);
    }
    const beneficiaries = state.beneficiaryKeys.map((key) => new Wallet(key).address);
    const txHash = await send(
      "vault:create",
      factory.connect(owner).createVault(
        CHECK_IN_INTERVAL_SECONDS,
        MAX_MISSED_CHECK_INS,
        beneficiaries,
        [7000, 3000]
      )
    );
    const receipt = await provider.getTransactionReceipt(txHash);
    const log = receipt?.logs.map((l) => factory.interface.parseLog({ topics: [...l.topics], data: l.data })).find((e) => e?.name === "VaultCreated");
    vaultAddress = log!.args.vault as string;
    record("vault:address", vaultAddress, txHash);
  }
  const vault = dynContract(new Contract(vaultAddress, vaultAbi, provider));
  console.log(`vault ${vaultAddress}`);

  // ---- 5. Owner configuration: reserve + deposits (idempotent) -------------
  const reserve: bigint = await readWithRetry("reserve", () => vault.automationReserve());
  if (reserve < RESERVE_TOPUP_WEI) {
    await send(
      "vault:topUpReserve",
      vault.connect(owner).topUpAutomationReserve({ value: RESERVE_TOPUP_WEI - reserve })
    );
  }
  const ethBalance: bigint = await readWithRetry("ethBalance", () => vault.protectedAssetBalance(ETH_SENTINEL));
  if (ethBalance < ETH_DEPOSIT_WEI) {
    await send("vault:depositETH", vault.connect(owner).depositETH({ value: ETH_DEPOSIT_WEI - ethBalance }));
  }
  const tokenBalance: bigint = await readWithRetry("vaultTokenBalance", () => vault.protectedAssetBalance(tokenAddress));
  if (tokenBalance === 0n) {
    await send("vault:approve", token.connect(owner).approve(vaultAddress, depositAmount));
    await send("vault:depositToken", vault.connect(owner).deposit(tokenAddress, depositAmount));
  }

  // ---- 6. Check-in (explicit evidence transaction) -------------------------
  if (!state.checkInDone || state.checkInDone !== vaultAddress) {
    await send("vault:checkIn", vault.connect(owner).checkIn());
    state.checkInDone = vaultAddress;
    saveState(state);
  }

  // ---- 7. Wait for on-chain eligibility (real time) ------------------------
  const deadline: bigint = await readWithRetry("deadline", () => vault.eligibilityDeadline());
  for (;;) {
    const now = BigInt(await withRetry("blockTimestamp", async () => {
      const block = await provider.getBlock("latest");
      return block!.timestamp;
    }));
    const stateName = inheritanceStateName(Number(await readWithRetry("state", () => vault.state())));
    if (stateName === "Eligible") {
      record("eligibility", `state=Eligible (deadline=${deadline})`);
      break;
    }
    const remaining = deadline > now ? deadline - now : 0n;
    console.log(`  waiting for eligibility: state=${stateName}, ${remaining}s remaining (deadline=${deadline})`);
    await sleep(15_000);
  }

  // ---- 8. Trigger (permissionless keeper) + duplicate rejection ------------
  if (!(await readWithRetry("triggered", () => vault.inheritanceTriggered()))) {
    await send("inheritance:trigger", vault.connect(keeper).triggerInheritance());
  }
  try {
    await vault.connect(keeper).triggerInheritance();
    throw new Error("duplicate trigger unexpectedly succeeded");
  } catch (error) {
    const message = String(error);
    if (!message.includes("unexpectedly succeeded")) {
      record("inheritance:duplicateTriggerRejected", "second trigger reverted as expected");
    } else throw error;
  }

  // ---- 9. Distribute each tracked asset (permissionless keeper) ------------
  const assets: string[] = await readWithRetry("trackedAssets", () => vault.getTrackedAssets());
  for (const asset of assets) {
    const processed: boolean = await readWithRetry("processed", () => vault.inheritanceAssetProcessed(asset));
    if (!processed) {
      await send("distribution:process", vault.connect(keeper).distributeInheritanceAsset(asset));
    }
  }
  // Retry loop for any failed entitlements (e.g. transient token failures).
  const beneficiaries = state.beneficiaryKeys.map((key) => new Wallet(key).address);
  for (let round = 0; round < 5; round += 1) {
    const pendingList: Array<{ asset: string; beneficiary: string; amount: bigint }> = [];
    for (const asset of assets) {
      for (const beneficiary of beneficiaries) {
        const pending: bigint = await vault.pendingInheritance(asset, beneficiary);
        if (pending !== 0n) pendingList.push({ asset, beneficiary, amount: pending });
      }
    }
    if (pendingList.length === 0) break;
    console.log(`  ${pendingList.length} pending entitlements, retry round ${round + 1}`);
    await sleep(5_000);
    for (const { asset, beneficiary } of pendingList) {
      await send(
        "distribution:retry",
        vault.connect(keeper).retryInheritanceDistribution(asset, beneficiary)
      );
    }
  }

  // ---- 10. Verify receipts and final state ---------------------------------
  for (const asset of assets) {
    for (const [index, beneficiary] of beneficiaries.entries()) {
      const pending: bigint = await vault.pendingInheritance(asset, beneficiary);
      if (pending !== 0n) throw new Error(`Unpaid entitlement: ${asset} -> ${beneficiary} (${pending})`);
      let received: bigint;
      if (asset === ETH_SENTINEL) {
        received = await provider.getBalance(beneficiary);
      } else {
        received = await token.connect(provider).balanceOf(beneficiary);
      }
      const expectedShare = index === 0 ? "70%" : "30%";
      record("distribution:receipt", `${beneficiary} holds ${received.toString()} of ${asset} (share ${expectedShare})`);
    }
  }
  const finalState = inheritanceStateName(Number(await readWithRetry("finalState", () => vault.state())));
  if (finalState !== "Distributed") throw new Error(`Expected Distributed, got ${finalState}`);
  record("state:final", "Distributed");

  // ---- 11. Claim remaining reserve (keeper incentive) ----------------------
  const remainingReserve: bigint = await readWithRetry("remainingReserve", () => vault.automationReserve());
  const keeperBalanceAfter = await provider.getBalance(keeper.address);
  if (remainingReserve !== 0n) {
    await send("reserve:claim", vault.connect(keeper).claimAutomationReserve());
    record("reserve:claim", `claimed ${formatEther(remainingReserve)} ETH`);
  }
  const keeperBalanceFinal = await provider.getBalance(keeper.address);
  console.log(
    `keeper gas net effect: ${keeperBalanceFinal >= keeperBalanceAfter ? "profitable" : "subsidized"} ` +
      `(${formatEther(keeperBalanceFinal - keeperBalanceAfter)} ETH delta from claim)`
  );

  // ---- 12. Evidence summary ------------------------------------------------
  console.log("\n===== E2E EVIDENCE =====");
  for (const item of evidence) {
    console.log(`${item.step.padEnd(36)} ${item.detail}${item.txHash ? `  tx=${item.txHash}` : ""}`);
  }
  console.log("\nE2E lifecycle complete: create -> deposit -> check-in -> trigger -> distribute -> claim");
}

main().catch((error) => {
  console.error(`\nE2E failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

