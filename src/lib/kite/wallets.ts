import { GokiteAASDK } from "gokite-aa-sdk";
import { ethers } from "ethers";
import {
  KITE_NETWORK,
  KITE_RPC_URL,
  KITE_BUNDLER_URL,
  SETTLEMENT_TOKEN,
} from "./config";
import type { AgentId } from "@/lib/types";

let sdkInstance: GokiteAASDK | null = null;

export function getSDK(): GokiteAASDK {
  if (!sdkInstance) {
    sdkInstance = new GokiteAASDK(KITE_NETWORK, KITE_RPC_URL, KITE_BUNDLER_URL);
  }
  return sdkInstance;
}

const PRIVATE_KEY_ENV: Record<AgentId | "verifier", string> = {
  A: "AGENT_A_PRIVATE_KEY",
  B: "AGENT_B_PRIVATE_KEY",
  C: "AGENT_C_PRIVATE_KEY",
  verifier: "VERIFIER_PRIVATE_KEY",
};

function getPrivateKey(agent: AgentId | "verifier"): string {
  const envVar = PRIVATE_KEY_ENV[agent];
  const key = process.env[envVar];
  if (!key) throw new Error(`${envVar} is not set`);
  return key;
}

export function getEOA(agent: AgentId | "verifier"): string {
  const wallet = new ethers.Wallet(getPrivateKey(agent));
  return wallet.address;
}

export function getAAWalletAddress(agent: AgentId | "verifier"): string {
  const sdk = getSDK();
  return sdk.getAccountAddress(getEOA(agent));
}

export function getSignFunction(
  agent: AgentId | "verifier"
): (userOpHash: string) => Promise<string> {
  const pk = getPrivateKey(agent);
  return async (userOpHash: string) => {
    const signer = new ethers.Wallet(pk);
    return signer.signMessage(ethers.getBytes(userOpHash));
  };
}

export async function getBalance(
  agent: AgentId | "verifier"
): Promise<{ kite: string; usdt: string }> {
  const provider = new ethers.JsonRpcProvider(KITE_RPC_URL);
  const aaAddress = getAAWalletAddress(agent);

  const erc20 = new ethers.Contract(SETTLEMENT_TOKEN, [
    "function balanceOf(address) view returns (uint256)",
  ], provider);

  const [kiteBalance, usdtBalance] = await Promise.all([
    provider.getBalance(aaAddress),
    erc20.balanceOf(aaAddress),
  ]);

  return {
    kite: ethers.formatEther(kiteBalance),
    usdt: ethers.formatEther(usdtBalance),
  };
}

export async function getAllWalletInfo() {
  const agents = ["A", "B", "C", "verifier"] as const;
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
    agentC:
      results[2].status === "fulfilled" ? results[2].value : { error: String((results[2] as PromiseRejectedResult).reason) },
    verifier:
      results[3].status === "fulfilled" ? results[3].value : { error: String((results[3] as PromiseRejectedResult).reason) },
  };
}
