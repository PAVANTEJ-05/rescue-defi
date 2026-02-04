/**
 * Aave V3 Repay Executor
 * Handles token approval and repay transaction execution
 * 
 * Uses executor EOA wallet for gas and liquidity
 */

import type { Signer, TransactionReceipt } from "ethers";
import { parseUnits, MaxUint256 } from "ethers";
import { getAavePool, getERC20 } from "./pool.js";

/** Variable interest rate mode for Aave V3 */
// MVP assumption: Rescue.ETH supports VARIABLE-rate borrows only
const VARIABLE_RATE_MODE = 2n;

/**
 * Parameters for executing a repay transaction
 */
export interface RepayParams {
  /** Aave V3 Pool contract address */
  poolAddress: string;
  /** Address of the debt token to repay (e.g., USDC, DAI) */
  debtTokenAddress: string;
  /** Amount to repay in token units (human-readable, e.g., "100.5") */
  repayAmount: string;
  /** Decimals of the debt token (e.g., 6 for USDC, 18 for DAI) */
  tokenDecimals: number;
  /** Address of the user whose debt is being repaid */
  onBehalfOf: string;
}

/**
 * Result of a successful repay execution
 */
export interface RepayResult {
  /** Transaction hash of the repay transaction */
  txHash: string;
  /** Amount repaid in token base units */
  amountRepaid: bigint;
  /** Block number of the transaction */
  blockNumber: number;
}

/**
 * Ensures sufficient token allowance for the Aave Pool
 * Sets max approval if current allowance is insufficient
 * 
 * @param tokenAddress - ERC20 token address
 * @param spender - Address to approve (Aave Pool)
 * @param amount - Required amount
 * @param signer - Executor wallet signer
 */
async function ensureAllowance(
  tokenAddress: string,
  spender: string,
  amount: bigint,
  signer: Signer
): Promise<void> {
  const token = getERC20(tokenAddress, signer);
  const owner = await signer.getAddress();
  
  const currentAllowance: bigint = await token.allowance(owner, spender);
  
  if (currentAllowance < amount) {
    console.log("[Aave Executor] Setting token allowance...");
    const approveTx = await token.approve(spender, MaxUint256);
    await approveTx.wait();
    console.log("[Aave Executor] Allowance set successfully");
  }
}

/**
 * Executes a debt repayment on Aave V3
 * 
 * Flow:
 * 1. Parse repay amount to token units
 * 2. Ensure token allowance for Pool
 * 3. Call Pool.repay()
 * 4. Wait for confirmation
 * 
 * @param params - Repay parameters
 * @param signer - Executor wallet signer (must have tokens and gas)
 * @returns Repay result with transaction details
 * @throws Error on any failure (no silent failures)
 */
export async function executeRepay(
  params: RepayParams,
  signer: Signer
): Promise<RepayResult> {
  const {
    poolAddress,
    debtTokenAddress,
    repayAmount,
    tokenDecimals,
    onBehalfOf,
  } = params;

  // Parse amount to token base units
  const amountInUnits = parseUnits(repayAmount, tokenDecimals);

  if (amountInUnits <= 0n) {
    throw new Error("[Aave Executor] Repay amount must be positive");
  }

  console.log(`[Aave Executor] Preparing repay of ${repayAmount} tokens for ${onBehalfOf}`);

  // Ensure allowance before repay
  await ensureAllowance(debtTokenAddress, poolAddress, amountInUnits, signer);

  // Get pool contract with signer
  const pool = getAavePool(poolAddress, signer);

  // Execute repay transaction
  console.log("[Aave Executor] Executing repay transaction...");
  const repayTx = await pool.repay(
    debtTokenAddress,
    amountInUnits,
    VARIABLE_RATE_MODE,
    onBehalfOf
  );

  // Wait for confirmation
  const receipt: TransactionReceipt = await repayTx.wait();

  if (!receipt || receipt.status !== 1) {
    throw new Error("[Aave Executor] Repay transaction failed");
  }

  console.log(`[Aave Executor] Repay successful: ${receipt.hash}`);

  return {
    txHash: receipt.hash,
    amountRepaid: amountInUnits,
    blockNumber: receipt.blockNumber,
  };
}
