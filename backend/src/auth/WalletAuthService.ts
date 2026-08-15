import { createHash, randomBytes } from "node:crypto";
import { getAddress, verifyTypedData, type TypedDataField } from "ethers";
import type { KinnDeployment } from "../deployments/DeploymentRegistry.js";
import { DeploymentRegistry } from "../deployments/DeploymentRegistry.js";

const walletLinkTypes: Record<string, TypedDataField[]> = {
  WalletLink: [
    { name: "wallet", type: "address" },
    { name: "telegramUserId", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" }
  ]
};

interface ChallengeRecord {
  deploymentKey: string;
  telegramUserId: string;
  wallet: string;
  nonce: string;
  issuedAt: bigint;
  expiresAt: bigint;
  consumed: boolean;
}

export interface WalletChallenge {
  deploymentKey: string;
  domain: { name: "Kinn"; version: "1"; chainId: number; verifyingContract: string };
  types: typeof walletLinkTypes;
  primaryType: "WalletLink";
  message: {
    wallet: string;
    telegramUserId: string;
    nonce: string;
    issuedAt: bigint;
    expiresAt: bigint;
  };
}

export interface WalletSession {
  token: string;
  deploymentKey: string;
  telegramUserId: string;
  wallet: string;
  expiresAt: number;
}

export interface WalletAssociation {
  deploymentKey: string;
  telegramUserId: string;
  wallet: string;
  verifiedAt: number;
}

export interface WalletAssociationRepository {
  save(association: WalletAssociation): Promise<void>;
  find(deploymentKey: string, telegramUserId: string): Promise<WalletAssociation | undefined>;
}

export class InMemoryWalletAssociationRepository implements WalletAssociationRepository {
  private readonly values = new Map<string, WalletAssociation>();
  async save(value: WalletAssociation) { this.values.set(`${value.deploymentKey}:${value.telegramUserId}`, value); }
  async find(deploymentKey: string, telegramUserId: string) {
    return this.values.get(`${deploymentKey}:${telegramUserId}`);
  }
}

export class WalletAuthService {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly sessions = new Map<string, Omit<WalletSession, "token">>();

  constructor(
    private readonly deployments: DeploymentRegistry,
    private readonly associations: WalletAssociationRepository,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
    private readonly challengeTtlSeconds = 600,
    private readonly sessionTtlSeconds = 3600
  ) {}

  createChallenge(deploymentKey: string, telegramUserId: string, walletAddress: string): WalletChallenge {
    if (!telegramUserId.trim()) throw new Error("Telegram user ID is required");
    const deployment = this.deployments.get(deploymentKey);
    const wallet = getAddress(walletAddress);
    const issuedAt = BigInt(this.now());
    const expiresAt = issuedAt + BigInt(this.challengeTtlSeconds);
    const nonce = `0x${randomBytes(32).toString("hex")}`;
    this.challenges.set(nonce, {
      deploymentKey, telegramUserId, wallet, nonce, issuedAt, expiresAt, consumed: false
    });
    return {
      deploymentKey,
      domain: this.domain(deployment),
      types: walletLinkTypes,
      primaryType: "WalletLink",
      message: { wallet, telegramUserId, nonce, issuedAt, expiresAt }
    };
  }

  async verifyChallenge(nonce: string, signature: string): Promise<WalletSession> {
    const record = this.challenges.get(nonce);
    if (!record || record.consumed) throw new Error("Challenge is invalid or already used");
    if (BigInt(this.now()) > record.expiresAt) throw new Error("Challenge has expired");
    const deployment = this.deployments.get(record.deploymentKey);
    const signer = getAddress(verifyTypedData(
      this.domain(deployment), walletLinkTypes,
      {
        wallet: record.wallet,
        telegramUserId: record.telegramUserId,
        nonce: record.nonce,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt
      },
      signature
    ));
    if (signer !== record.wallet) throw new Error("Signature does not match wallet");
    record.consumed = true;

    const verifiedAt = this.now();
    await this.associations.save({
      deploymentKey: record.deploymentKey,
      telegramUserId: record.telegramUserId,
      wallet: record.wallet,
      verifiedAt
    });
    const token = randomBytes(32).toString("base64url");
    const session = {
      deploymentKey: record.deploymentKey,
      telegramUserId: record.telegramUserId,
      wallet: record.wallet,
      expiresAt: verifiedAt + this.sessionTtlSeconds
    };
    this.sessions.set(this.hashToken(token), session);
    return { token, ...session };
  }

  requireSession(token: string, deploymentKey?: string): Omit<WalletSession, "token"> {
    const session = this.sessions.get(this.hashToken(token));
    if (!session || this.now() > session.expiresAt) throw new Error("Session is invalid or expired");
    if (deploymentKey && session.deploymentKey !== deploymentKey) throw new Error("Session deployment mismatch");
    return session;
  }

  private domain(deployment: KinnDeployment) {
    return {
      name: "Kinn" as const,
      version: "1" as const,
      chainId: deployment.chainId,
      verifyingContract: deployment.contractAddress
    };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
