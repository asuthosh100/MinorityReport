import { ethers } from "ethers";
import { getSDK, getEOA, getAAWalletAddress, getSignFunction } from "./wallets";
import {
  STAKE_AMOUNT,
  VERIFIER_CUT_PERCENT,
  SETTLEMENT_TOKEN,
} from "./config";

export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Transfer native KITE from one agent's AA wallet to another address.
 * Uses estimateUserOperation + sendUserOperationWithPayment for proper gas buffers.
 */
async function transferKite(
  from: "A" | "B" | "verifier",
  toAddress: string,
  amount: string
): Promise<TransactionResult> {
  const sdk = getSDK();
  const eoa = getEOA(from);
  const signFn = getSignFunction(from);

  const transferRequest = {
    target: toAddress,
    value: ethers.parseEther(amount),
    callData: "0x",
  };

  try {
    // Step 1: Estimate gas (adds proper buffers to verificationGasLimit)
    const estimate = await sdk.estimateUserOperation(eoa, transferRequest);

    // Step 2: Send with estimated gas, paying gas fees via USDT settlement token
    const result = await sdk.sendUserOperationWithPayment(
      eoa,
      transferRequest,
      estimate.userOp,
      SETTLEMENT_TOKEN,
      signFn,
    );

    if (result.status.status === "success") {
      return { success: true, transactionHash: result.status.transactionHash };
    }
    return { success: false, error: result.status.reason || "Transaction failed" };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Stake KITE from an agent to the verifier's AA wallet (acting as escrow).
 */
export async function stakeFromAgent(
  agent: "A" | "B"
): Promise<TransactionResult> {
  const verifierWallet = getAAWalletAddress("verifier");
  return transferKite(agent, verifierWallet, STAKE_AMOUNT);
}

/**
 * Distribute the staked pool: winner gets 90%, verifier keeps 10%.
 */
export async function distributeRewards(
  winner: "A" | "B"
): Promise<{ winnerTx: TransactionResult; verifierCut: string; winnerAmount: string }> {
  const totalPool = parseFloat(STAKE_AMOUNT) * 2;
  const verifierCut = (totalPool * VERIFIER_CUT_PERCENT) / 100;
  const winnerAmount = totalPool - verifierCut;

  // Verifier sends the winner's share to the winner's AA wallet
  const winnerWallet = getAAWalletAddress(winner);
  const winnerTx = await transferKite(
    "verifier",
    winnerWallet,
    winnerAmount.toString()
  );

  return {
    winnerTx,
    verifierCut: verifierCut.toString(),
    winnerAmount: winnerAmount.toString(),
  };
}
