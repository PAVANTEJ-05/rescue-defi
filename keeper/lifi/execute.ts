/**
 * LI.FI Transaction Execution for Rescue.ETH
 * 
 * ============================================================
 * DEMO-ONLY / FORK ENVIRONMENT
 * ============================================================
 * This module handles the actual transaction submission for LI.FI quotes.
 * 
 * IMPORTANT NOTES:
 * 1. Gas fields are STRIPPED from transactions to let viem/local node estimate
 *    This is required because fork gas estimates differ from mainnet
 * 
 * 2. Transactions are submitted to LOCAL FORKS, not real networks
 *    Real bridges/relayers cannot see these transactions
 * 
 * 3. After execution on source chain, bridge simulation is required
 *    (See simulate.ts for manual token delivery on destination)
 * 
 * PRODUCTION DIFFERENCES:
 * - Keep gas fields or let wallet estimate
 * - Real bridge relayers will complete the cross-chain transfer
 * - No manual simulation needed
 * ============================================================
 */

import type { Signer } from 'ethers';
import { Contract } from 'ethers';
import type { LiFiQuoteResponse, ExecuteParams } from './types.js';
import { getWalletClientForChain, getPublicClientForChain } from './config.js';
import type { RescueResult } from '../config/types.js';

// ============================================================
// TRANSACTION EXECUTION
// ============================================================

/**
 * Execute a LI.FI transaction on a forked network
 * 
 * This function:
 * 1. Gets the appropriate wallet/public clients for the source chain
 * 2. Strips gas fields to let local node estimate (fork-specific)
 * 3. Submits the transaction
 * 4. Waits for confirmation
 * 
 * @param chainId - Source chain ID
 * @param transactionRequest - Full transaction request from LI.FI quote
 * @returns Transaction hash and receipt
 */
export async function executeTransaction(
  chainId: number,
  transactionRequest: any
): Promise<{ hash: string; blockNumber: bigint }> {
  const walletClient = getWalletClientForChain(chainId);
  const publicClient = getPublicClientForChain(chainId);

  // Strip gas fields - let viem/local node estimate
  // This is REQUIRED for fork environments where gas estimates differ
  const {
    gas,
    gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
    ...txRequest
  } = transactionRequest;

  console.log('Submitting transaction to fork...');
  console.log('  To:', txRequest.to);
  console.log('  Value:', txRequest.value?.toString() ?? '0');
  console.log('  Data length:', txRequest.data?.length ?? 0);

  // Submit transaction
  const hash = await walletClient.sendTransaction(txRequest);
  console.log(`Transaction submitted: ${hash}`);

  // Wait for confirmation
  console.log('Waiting for confirmation...');
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  return {
    hash,
    blockNumber: receipt.blockNumber,
  };
}

// ============================================================
// COOLDOWN TRACKING
// ============================================================

/**
 * RescueExecutor contract ABI for cooldown checks
 */
const RESCUE_EXECUTOR_ABI = [
  'function lastRescueTime(address user) view returns (uint256)',
] as const;

/**
 * Check if cooldown has passed for a user
 * 
 * The RescueExecutor contract tracks when each user was last rescued.
 * This prevents rapid repeated rescues that could drain user funds.
 * 
 * @param executorAddress - RescueExecutor contract address
 * @param userAddress - User to check
 * @param cooldownSeconds - Required cooldown period from ENS policy
 * @param signer - Ethers signer for contract calls
 * @returns True if cooldown has passed (or no previous rescue)
 */
export async function isCooldownPassed(
  executorAddress: string,
  userAddress: string,
  cooldownSeconds: number,
  signer: Signer
): Promise<boolean> {
  try {
    const executor = new Contract(executorAddress, RESCUE_EXECUTOR_ABI, signer);
    // Use getFunction to properly type the call
    const lastRescueTimeFn = executor.getFunction('lastRescueTime');
    const lastRescueTime = await lastRescueTimeFn(userAddress);
    
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - Number(lastRescueTime);
    
    return elapsed >= cooldownSeconds;
  } catch (error) {
    // If contract call fails (e.g., never rescued), assume cooldown passed
    console.warn('Cooldown check failed, assuming passed:', error);
    return true;
  }
}

// ============================================================
// RESCUE EXECUTION (KEEPER INTEGRATION)
// ============================================================

/**
 * RescueExecutor contract ABI for rescue execution
 */
const RESCUE_EXECUTOR_FULL_ABI = [
  'function lastRescueTime(address user) view returns (uint256)',
  'function executeRescue(address user, address tokenIn, uint256 amountIn, address lifiTarget, bytes calldata lifiData, uint256 lifiValue) payable',
] as const;

/**
 * Execute a rescue via the RescueExecutor contract
 * 
 * This is the main entry point for the keeper to execute a rescue.
 * It calls the RescueExecutor.executeRescue() function which:
 * 1. Transfers tokens from user to executor (requires prior approval)
 * 2. Forwards to LI.FI for bridge/swap
 * 3. LI.FI calls Aave.supply() on destination
 * 
 * @param executorAddress - RescueExecutor contract address
 * @param params - Execution parameters (user, token, amount, quote)
 * @param signer - Ethers signer (keeper wallet)
 * @returns Rescue result with success status and transaction hash
 */
export async function executeRescue(
  executorAddress: string,
  params: ExecuteParams,
  signer: Signer
): Promise<RescueResult> {
  const { userAddress, tokenIn, amountIn, quote, amountUSD } = params;

  try {
    const executor = new Contract(executorAddress, RESCUE_EXECUTOR_FULL_ABI, signer);

    console.log('Executing rescue...');
    console.log('  User:', userAddress);
    console.log('  Token:', tokenIn);
    console.log('  Amount:', amountIn.toString());
    console.log('  USD value:', amountUSD.toFixed(2));

    // Execute the rescue using getFunction for proper typing
    const executeRescueFn = executor.getFunction('executeRescue');
    const tx = await executeRescueFn(
      userAddress,
      tokenIn,
      amountIn,
      quote.to,
      quote.data,
      BigInt(quote.value),
      {
        value: BigInt(quote.value), // msg.value for native token bridges
      }
    );

    console.log('Waiting for transaction...');
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: receipt.hash,
      amountUSD,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('Rescue execution failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      amountUSD,
      timestamp: Date.now(),
    };
  }
}

// ============================================================
// ROUTE STEP EXECUTION (FROM ORIGINAL INDEX.TS)
// ============================================================

/**
 * Execute a single step of a LI.FI route
 * 
 * This is preserved from the original implementation.
 * Used for multi-step routes (multiple bridges/swaps).
 * 
 * NOTE: For Rescue.ETH, we primarily use contractCallsQuote which
 * bundles everything into a single transaction. This function is
 * kept for compatibility with standard LI.FI routes if needed.
 * 
 * @param step - Step information from route
 * @param getStepTransaction - LI.FI SDK function to get step tx data
 * @returns Execution result
 */
export async function executeRouteStep(
  step: any,
  getStepTransaction: (step: any) => Promise<any>
): Promise<{ hash: string; blockNumber: bigint }> {
  // Get transaction data for the step
  const stepWithTx = await getStepTransaction(step);
  
  if (!stepWithTx.transactionRequest) {
    throw new Error('Missing transactionRequest for step');
  }

  // Execute on the source chain
  const fromChainId = stepWithTx.action.fromChainId;
  return executeTransaction(fromChainId, stepWithTx.transactionRequest);
}

// ============================================================
// EXPORTS
// ============================================================

export type { ExecuteParams };
