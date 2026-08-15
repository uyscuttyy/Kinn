import { getAddress } from "ethers";

export interface KinnDeployment {
  key: string;
  chainId: number;
  contractAddress: string;
}

export class DeploymentRegistry {
  private readonly deployments = new Map<string, KinnDeployment>();

  constructor(values: KinnDeployment[]) {
    for (const value of values) {
      if (!value.key) throw new Error("Deployment key is required");
      if (!Number.isSafeInteger(value.chainId) || value.chainId <= 0) throw new Error("Invalid deployment chain ID");
      if (this.deployments.has(value.key)) throw new Error(`Duplicate deployment key: ${value.key}`);
      this.deployments.set(value.key, { ...value, contractAddress: getAddress(value.contractAddress) });
    }
  }

  get(key: string): KinnDeployment {
    const deployment = this.deployments.get(key);
    if (!deployment) throw new Error(`Unknown deployment: ${key}`);
    return deployment;
  }

  list(): KinnDeployment[] {
    return [...this.deployments.values()];
  }
}
