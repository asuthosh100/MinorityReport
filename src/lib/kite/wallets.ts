import { GokiteAASDK } from "gokite-aa-sdk";
import { ethers } from "ethers";
import {
  KITE_NETWORK,
  KITE_RPC_URL,
  KITE_BUNDLER_URL,
} from "./config";

let sdkInstance: GokiteAASDK | null = null;

export function getSDK(): GokiteAASDK {
  if (!sdkInstance) {
    sdkInstance = new GokiteAASDK(KITE_NETWORK, KITE_RPC_URL, KITE_BUNDLER_URL);
  }
  return sdkInstance;
}

function getPrivateKey(agent: "A" | "B" | "verifier"): string {
  const envVar =
    agent === "A"
      ? "AGENT_A_PRIVATE_KEY"
      : agent === "B"
        ? "AGENT_B_PRIVATE_KEY"
        : "VERIFIER_PRIVATE_KEY";
  const key = process.env[envVar];
  if (!key) throw new Error(`${envVar} is not set`);
  return key;
}

export function getEOA(agent: "A" | "B" | "verifier"): string {
  const wallet = new ethers.Wallet(getPrivateKey(agent));
  return wallet.address;
}

export function getAAWalletAddress(agent: "A" | "B" | "verifier"): string {
  const sdk = getSDK();
  return sdk.getAccountAddress(getEOA(agent));
}

export function getSignFunction(
  agent: "A" | "B" | "verifier"
): (userOpHash: string) => Promise<string> {
  const pk = getPrivateKey(agent);
  return async (userOpHash: string) => {
    const signer = new ethers.Wallet(pk);
    return signer.signMessage(ethers.getBytes(userOpHash));
  };
}

export async function getBalance(
  agent: "A" | "B" | "verifier"
): Promise<{ kite: string }> {
  const provider = new ethers.JsonRpcProvider(KITE_RPC_URL);
  const aaAddress = getAAWalletAddress(agent);
  const kiteBalance = await provider.getBalance(aaAddress);
  return { kite: ethers.formatEther(kiteBalance) };
}

export async function getAllWalletInfo() {
  const agents = ["A", "B", "verifier"] as const;
  const results = await Promise.allSettled(
    agents.map(async (agent) => ({
      agent,
      eoa: getEOA(agent),
      aaWallet: getAAWalletAddress(agent),
      balance: await getBalance(agent),
    }))
  );

  return {
    agentA:
      results[0].status === "fulfilled" ? results[0].value : { error: String((results[0] as PromiseRejectedResult).reason) },
    agentB:
      results[1].status === "fulfilled" ? results[1].value : { error: String((results[1] as PromiseRejectedResult).reason) },
    verifier:
      results[2].status === "fulfilled" ? results[2].value : { error: String((results[2] as PromiseRejectedResult).reason) },
  };
}
