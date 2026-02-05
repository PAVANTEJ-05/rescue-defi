/**
 * LI.FI Execute via RescueExecutor
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Submits transactions to RescueExecutor contract
 * - Passes LI.FI calldata for token routing/bridging
 * - Handles gas payment and msg.value
 * - Checks cooldown status before execution
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT supply tokens to Aave (see CRITICAL NOTE below)
 * - Does NOT verify user has approved tokens
 * - Does NOT simulate the transaction
 * 
 * ============================================================
 * CRITICAL ARCHITECTURAL GAP:
 * ============================================================
 * This module executes LI.FI routing, which swaps/bridges tokens.
 * However, LI.FI does NOT automatically supply tokens to Aave.
 * 
 * After executeRescue() completes:
 * - Tokens have been routed (swapped/bridged) via LI.FI
 * - Tokens are sitting in the user's wallet (or RescueExecutor)
 * - Tokens are NOT deposited as Aave collateral
 * 
 * TO COMPLETE THE RESCUE, one of these is needed:
 * 1. Add AavePool.supply() call in RescueExecutor.executeRescue()
 * 2. Use LI.FI hooks to call Aave after the swap
 * 3. Add a second transaction step in this module
 * 
 * This is a known TODO for Phase 1+.
 * ============================================================
 * 
 * PRODUCTION RULES:
 * - Contract executes blindly but safely (target restricted to LI.FI router)
 * - Keeper never edits calldata from LI.FI
 * - User funds pulled via transferFrom (pre-approved)
 */

import { Contract, type Signer, type TransactionReceipt } from 'ethers';
import type { LiFiQuote, RescueResult } from '../config/types.js';
import { logger } from '../utils/logger.js';

/**
 * RescueExecutor ABI (only executeRescue function)
 */
const RESCUE_EXECUTOR_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'user', type: 'address' },
      { internalType: 'address', name: 'tokenIn', type: 'address' },
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'address', name: 'target', type: 'address' },
      { internalType: 'bytes', name: 'callData', type: 'bytes' },
    ],
    name: 'executeRescue',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'lastRescueAt',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

/**
 * Execution parameters for rescue
 */
export interface ExecuteParams {
  /** User being rescued */
  userAddress: string;
  /** Token to pull from user (address(0) for ETH) */
  tokenIn: string;
  /** Amount of tokenIn to pull */
  amountIn: bigint;
  /** LI.FI quote with calldata */
  quote: LiFiQuote;
  /** Amount in USD (for logging) */
  amountUSD: number;
}

/**
 * Execute rescue via RescueExecutor contract
 * 
 * @param executorAddress - RescueExecutor contract address
 * @param params - Execution parameters
 * @param signer - Keeper wallet signer
 * @returns Result with transaction hash or error
 */
export async function executeRescue(
  executorAddress: string,
  params: ExecuteParams,
  signer: Signer
): Promise<RescueResult> {
  const { userAddress, tokenIn, amountIn, quote, amountUSD } = params;

  logger.executor.info('Executing rescue', {
    user: userAddress.slice(0, 10),
    token: tokenIn.slice(0, 10),
    amount: amountIn.toString(),
    amountUSD: amountUSD.toFixed(2),
    target: quote.to.slice(0, 10),
  });

  try {
    const executor = new Contract(executorAddress, RESCUE_EXECUTOR_ABI, signer);

    // Determine msg.value - only needed if tokenIn is native ETH
    const isNativeToken = tokenIn === '0x0000000000000000000000000000000000000000';
    const msgValue = isNativeToken ? BigInt(quote.value) : 0n;

    // Execute the rescue
    type ExecuteRescueFn = (
      user: string,
      tokenIn: string,
      amountIn: bigint,
      target: string,
      callData: string,
      overrides: { value: bigint }
    ) => Promise<{ hash: string; wait: () => Promise<TransactionReceipt> }>;
    
    const tx = await (executor.executeRescue as ExecuteRescueFn)(
      userAddress,
      tokenIn,
      amountIn,
      quote.to,
      quote.data,
      { value: msgValue }
    );

    logger.executor.info('Transaction submitted', { txHash: tx.hash });

    // Wait for confirmation
    const receipt: TransactionReceipt = await tx.wait();

    if (receipt.status === 0) {
      throw new Error('Transaction reverted');
    }

    logger.executor.info('Rescue executed successfully', {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    });

    return {
      success: true,
      txHash: receipt.hash,
      amountUSD,
      timestamp: Date.now(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check for specific revert reasons
    if (errorMessage.includes('CooldownActive')) {
      logger.executor.warn('Cooldown still active', { user: userAddress });
    } else if (errorMessage.includes('OnlyKeeper')) {
      logger.executor.error('Not authorized as keeper');
    } else if (errorMessage.includes('InvalidTarget')) {
      logger.executor.error('Invalid target address (not LI.FI router)');
    } else {
      logger.executor.error('Rescue failed', { error: errorMessage });
    }

    return {
      success: false,
      error: errorMessage,
      amountUSD,
      timestamp: Date.now(),
    };
  }
}

/**
 * Check if user cooldown has passed
 * 
 * @param executorAddress - RescueExecutor contract address
 * @param userAddress - User to check
 * @param cooldownSeconds - Required cooldown period
 * @param signer - Signer for read call
 * @returns true if cooldown has passed
 */
export async function isCooldownPassed(
  executorAddress: string,
  userAddress: string,
  cooldownSeconds: number,
  signer: Signer
): Promise<boolean> {
  try {
    const executor = new Contract(executorAddress, RESCUE_EXECUTOR_ABI, signer);
    const lastRescue: bigint = await (executor.lastRescueAt as (user: string) => Promise<bigint>)(userAddress);

    if (lastRescue === 0n) {
      // Never rescued before
      return true;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const cooldownEnd = Number(lastRescue) + cooldownSeconds;

    return nowSeconds >= cooldownEnd;
  } catch (error) {
    logger.executor.error('Failed to check cooldown', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    // Fail closed - assume cooldown not passed
    return false;
  }
}

/**
 * Get remaining cooldown time in seconds
 */
export async function getRemainingCooldown(
  executorAddress: string,
  userAddress: string,
  cooldownSeconds: number,
  signer: Signer
): Promise<number> {
  try {
    const executor = new Contract(executorAddress, RESCUE_EXECUTOR_ABI, signer);
    const lastRescue: bigint = await (executor.lastRescueAt as (user: string) => Promise<bigint>)(userAddress);

    if (lastRescue === 0n) {
      return 0;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const cooldownEnd = Number(lastRescue) + cooldownSeconds;
    const remaining = cooldownEnd - nowSeconds;

    return Math.max(0, remaining);
  } catch {
    return cooldownSeconds; // Assume full cooldown on error
  }
}
