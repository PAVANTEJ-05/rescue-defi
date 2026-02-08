/**
 * LI.FI Transaction Execution for Rescue.ETH
 * 
 * ============================================================
 * PRODUCTION MODULE
 * ============================================================
 * This module handles rescue execution through the RescueExecutor
 * smart contract. The keeper calls executeRescue() which:
 * 
 * 1. Pulls ERC20 tokens from user via transferFrom (requires approval)
 * 2. Approves the immutable lifiRouter for exact amount
 * 3. Forwards LiFi callData to lifiRouter (bridge + Aave supply)
 * 4. Clears remaining approval
 * 5. Verifies zero residual token balance
 * 
 * GAS HANDLING:
 * - Gas is estimated via eth_estimateGas before submission
 * - A 20% buffer is added to the estimate for safety
 * - If gas estimation fails, the error is parsed for specific failure reasons
 *   (approval, cooldown, keeper auth, LiFi call, invalid target, residual balance)
 * 
 * ERROR HANDLING:
 * - All errors are caught and returned as structured RescueResult
 * - The keeper NEVER crashes on a rescue failure — it logs and moves to the next user
 * ============================================================
 */

import type { Signer } from 'ethers';
import { Contract } from 'ethers';
import type { LiFiQuoteResponse, ExecuteParams } from './types.js';
import type { RescueResult } from '../config/types.js';
import { logger } from '../utils/logger.js';

// ============================================================
// COOLDOWN TRACKING
// ============================================================

/**
 * RescueExecutor contract ABI for cooldown checks
 * 
 * CRITICAL: Must match deployed RescueExecutor.sol
 * The contract uses `lastRescueAt` (not `lastRescueTime`).
 */
const RESCUE_EXECUTOR_ABI = [
  'function lastRescueAt(address user) view returns (uint256)',
] as const;

/**
 * Cooldown check result (INFORMATIONAL ONLY)
 * 
 * The on-chain contract is the source of truth for cooldown enforcement.
 * This check is informational to avoid wasting gas on transactions that will revert.
 */
export interface CooldownInfo {
  /** Whether cooldown has likely passed (not authoritative) */
  passed: boolean;
  /** Remaining seconds if cooldown is active (estimate) */
  remainingSeconds: number;
  /** Last rescue timestamp from contract */
  lastRescueTime: number;
}

/**
 * Check cooldown status (INFORMATIONAL ONLY)
 * 
 * IMPORTANT: This check is NOT an execution gate.
 * The RescueExecutor contract is the authoritative source of truth.
 * This function exists only to log informational warnings.
 * 
 * @param executorAddress - RescueExecutor contract address
 * @param userAddress - User to check
 * @param cooldownSeconds - Required cooldown period from ENS policy
 * @param signer - Ethers signer for contract calls
 * @returns Cooldown information (not authoritative)
 */
export async function checkCooldownInfo(
  executorAddress: string,
  userAddress: string,
  cooldownSeconds: number,
  signer: Signer
): Promise<CooldownInfo> {
  try {
    const executor = new Contract(executorAddress, RESCUE_EXECUTOR_ABI, signer);
    const lastRescueAtFn = executor.getFunction('lastRescueAt');
    const lastRescueTime = await lastRescueAtFn(userAddress);
    
    const lastTime = Number(lastRescueTime);
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - lastTime;
    const remaining = Math.max(0, cooldownSeconds - elapsed);
    
    return {
      passed: elapsed >= cooldownSeconds,
      remainingSeconds: remaining,
      lastRescueTime: lastTime,
    };
  } catch (error) {
    // If contract call fails (e.g., never rescued), assume cooldown passed
    logger.executor.debug('Cooldown check failed, assuming passed', { 
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return {
      passed: true,
      remainingSeconds: 0,
      lastRescueTime: 0,
    };
  }
}

/**
 * @deprecated Use checkCooldownInfo instead. Cooldown is enforced by contract, not keeper.
 */
export async function isCooldownPassed(
  executorAddress: string,
  userAddress: string,
  cooldownSeconds: number,
  signer: Signer
): Promise<boolean> {
  const info = await checkCooldownInfo(executorAddress, userAddress, cooldownSeconds, signer);
  return info.passed;
}

// ============================================================
// RESCUE EXECUTION (KEEPER INTEGRATION)
// ============================================================

/**
 * RescueExecutor contract ABI for rescue execution
 * 
 * CRITICAL: This ABI MUST match the deployed RescueExecutor.sol exactly.
 * The contract's `executeRescue` takes 4 params: (user, tokenIn, amountIn, callData).
 * The lifiRouter address is an immutable set in the constructor — it is NOT passed per-call.
 * The `callData` arg is the raw LiFi transactionRequest.data from getContractCallsQuote.
 * The contract forwards it via: lifiRouter.call{value: msg.value}(callData)
 * 
 * Source of truth: contracts/RescueExecutor.sol and lifi/newexecute.ts
 */
const RESCUE_EXECUTOR_FULL_ABI = [
  'function lastRescueAt(address user) view returns (uint256)',
  'function executeRescue(address user, address tokenIn, uint256 amountIn, bytes callData) payable',
  'function keeper() view returns (address)',
  'function lifiRouter() view returns (address)',
  'function COOLDOWN_SECONDS() view returns (uint256)',
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
 * ERROR HANDLING (CRITICAL):
 * - Approval failures are detected and logged clearly
 * - Cooldown violations are caught (contract enforces)
 * - Gas estimation failures are reported
 * - RPC rejection errors are caught
 * - All errors return structured result, NEVER crash the keeper
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
  const userLog = userAddress.slice(0, 10) + '...';

  try {
    // Validate inputs before proceeding
    if (!executorAddress || !executorAddress.startsWith('0x')) {
      return {
        success: false,
        error: 'INVALID_EXECUTOR: Invalid executor address',
        amountUSD,
        timestamp: Date.now(),
      };
    }

    if (!quote || !quote.to || !quote.data) {
      return {
        success: false,
        error: 'INVALID_QUOTE: Quote is missing required fields',
        amountUSD,
        timestamp: Date.now(),
      };
    }

    const executor = new Contract(executorAddress, RESCUE_EXECUTOR_FULL_ABI, signer);

    logger.executor.info('Preparing rescue transaction', {
      user: userLog,
      token: tokenIn.slice(0, 10) + '...',
      amount: amountIn.toString(),
      usdValue: amountUSD.toFixed(2),
      lifiTarget: quote.to.slice(0, 10) + '...',
    });

    // Attempt gas estimation first to catch errors early
    let gasEstimate: bigint | undefined;
    try {
      const executeRescueFn = executor.getFunction('executeRescue');
      // 4 args matching contract: (user, tokenIn, amountIn, callData)
      // callData = raw LiFi transactionRequest.data, forwarded to lifiRouter
      gasEstimate = await executeRescueFn.estimateGas(
        userAddress,
        tokenIn,
        amountIn,
        quote.data,
        {
          value: BigInt(quote.value),
        }
      );
      logger.executor.debug('Gas estimate successful', { 
        gasEstimate: gasEstimate.toString(),
      });
    } catch (gasError) {
      // Gas estimation failed - this usually means the tx will revert
      const gasErrorMsg = gasError instanceof Error ? gasError.message : 'Unknown gas error';
      
      // Parse specific failure reasons
      if (gasErrorMsg.includes('transferFrom') || gasErrorMsg.includes('allowance') || gasErrorMsg.includes('ERC20')) {
        logger.executor.error('Gas estimation failed - likely approval issue', {
          user: userLog,
          error: gasErrorMsg,
          suggestion: 'User must approve RescueExecutor to spend their tokens',
        });
        return {
          success: false,
          error: 'APPROVAL_FAILURE: Token transfer will fail - user has not approved executor',
          amountUSD,
          timestamp: Date.now(),
        };
      }
      
      if (gasErrorMsg.includes('CooldownActive') || gasErrorMsg.includes('cooldown')) {
        logger.executor.error('Gas estimation failed - cooldown active', {
          user: userLog,
        });
        return {
          success: false,
          error: 'COOLDOWN_ACTIVE: Contract cooldown has not passed',
          amountUSD,
          timestamp: Date.now(),
        };
      }

      if (gasErrorMsg.includes('OnlyKeeper')) {
        logger.executor.error('Gas estimation failed - not authorized keeper', {
          user: userLog,
        });
        return {
          success: false,
          error: 'NOT_KEEPER: Signer is not the authorized keeper',
          amountUSD,
          timestamp: Date.now(),
        };
      }

      // Contract-specific errors from RescueExecutor.sol
      if (gasErrorMsg.includes('LiFiCallFailed')) {
        logger.executor.error('Gas estimation failed - LiFi call would fail', {
          user: userLog,
          error: gasErrorMsg,
          suggestion: 'LiFi router may be stale, diamond facet missing, or calldata invalid',
        });
        return {
          success: false,
          error: 'LIFI_CALL_FAILED: LiFi router call would fail - check router/facet status',
          amountUSD,
          timestamp: Date.now(),
        };
      }

      if (gasErrorMsg.includes('InvalidTarget')) {
        logger.executor.error('Gas estimation failed - invalid target', {
          user: userLog,
        });
        return {
          success: false,
          error: 'INVALID_TARGET: Contract rejected the target address',
          amountUSD,
          timestamp: Date.now(),
        };
      }

      if (gasErrorMsg.includes('ResidualBalance')) {
        logger.executor.error('Gas estimation failed - residual balance detected', {
          user: userLog,
          note: 'Contract enforces zero residual balance after execution',
        });
        return {
          success: false,
          error: 'RESIDUAL_BALANCE: Tokens would remain in executor after rescue',
          amountUSD,
          timestamp: Date.now(),
        };
      }

      // Generic gas estimation failure
      logger.executor.error('Gas estimation failed', {
        user: userLog,
        error: gasErrorMsg,
      });
      return {
        success: false,
        error: `GAS_ESTIMATION_FAILED: ${gasErrorMsg.slice(0, 200)}`,
        amountUSD,
        timestamp: Date.now(),
      };
    }

    // Execute the rescue transaction
    logger.executor.info('Submitting rescue transaction', {
      user: userLog,
      gasEstimate: gasEstimate?.toString(),
    });

    const executeRescueFn = executor.getFunction('executeRescue');
    // 4 args matching contract: (user, tokenIn, amountIn, callData)
    // The contract forwards callData to its immutable lifiRouter via:
    //   lifiRouter.call{value: msg.value}(callData)
    const tx = await executeRescueFn(
      userAddress,
      tokenIn,
      amountIn,
      quote.data,
      {
        value: BigInt(quote.value),
        // Add 20% buffer to gas estimate for safety
        gasLimit: gasEstimate ? (gasEstimate * 120n) / 100n : undefined,
      }
    );

    logger.executor.info('Transaction submitted, waiting for confirmation', {
      txHash: tx.hash,
      user: userLog,
    });
    
    // Wait for transaction confirmation
    const receipt = await tx.wait();

    // Check if transaction was successful
    if (receipt.status === 0) {
      logger.executor.error('Transaction reverted on-chain', {
        txHash: receipt.hash,
        user: userLog,
        blockNumber: receipt.blockNumber,
      });
      return {
        success: false,
        txHash: receipt.hash,
        error: 'TRANSACTION_REVERTED: Transaction was mined but reverted',
        amountUSD,
        timestamp: Date.now(),
      };
    }

    logger.executor.info('Rescue transaction confirmed successfully', {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toString(),
      user: userLog,
      amountUSD: amountUSD.toFixed(2),
    });

    return {
      success: true,
      txHash: receipt.hash,
      amountUSD,
      timestamp: Date.now(),
    };
  } catch (error) {
    // Catch-all for any unexpected errors
    // CRITICAL: Never crash the keeper - always return a structured result
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Parse error for better diagnostics
    let failureReason = `TRANSACTION_FAILED: ${errorMessage.slice(0, 200)}`;
    
    if (errorMessage.includes('transferFrom') || errorMessage.includes('allowance')) {
      failureReason = 'APPROVAL_FAILURE: User has not approved executor for token transfer';
      logger.executor.error('Rescue failed - approval issue', {
        user: userLog,
        token: tokenIn.slice(0, 10) + '...',
        suggestion: 'User must approve RescueExecutor contract to spend their tokens',
      });
    } else if (errorMessage.includes('CooldownActive')) {
      failureReason = 'COOLDOWN_ACTIVE: Contract cooldown has not passed';
      logger.executor.error('Rescue failed - cooldown active', {
        user: userLog,
        note: 'Contract enforced cooldown - this is expected behavior',
      });
    } else if (errorMessage.includes('OnlyKeeper')) {
      failureReason = 'NOT_KEEPER: Signer is not the authorized keeper';
      logger.executor.error('Rescue failed - not keeper', {
        note: 'Check KEEPER_PRIVATE_KEY matches deployed contract keeper address',
      });
    } else if (errorMessage.includes('LiFiCallFailed')) {
      failureReason = 'LIFI_CALL_FAILED: LiFi router call failed on-chain';
      logger.executor.error('Rescue failed - LiFi call failed', {
        user: userLog,
        note: 'Check fork freshness, diamond facet, or calldata validity',
      });
    } else if (errorMessage.includes('InvalidTarget')) {
      failureReason = 'INVALID_TARGET: Contract rejected the target';
      logger.executor.error('Rescue failed - invalid target', {
        user: userLog,
      });
    } else if (errorMessage.includes('ResidualBalance')) {
      failureReason = 'RESIDUAL_BALANCE: Tokens remained in executor';
      logger.executor.error('Rescue failed - residual balance', {
        user: userLog,
        note: 'LiFi did not consume all tokens; potential slippage issue',
      });
    } else if (errorMessage.includes('insufficient funds') || errorMessage.includes('INSUFFICIENT_FUNDS')) {
      failureReason = 'INSUFFICIENT_FUNDS: Keeper wallet has insufficient ETH for gas';
      logger.executor.error('Rescue failed - insufficient funds', {
        user: userLog,
        note: 'Fund the keeper wallet with ETH for gas',
      });
    } else if (errorMessage.includes('nonce') || errorMessage.includes('replacement')) {
      failureReason = 'NONCE_ERROR: Transaction nonce issue';
      logger.executor.error('Rescue failed - nonce issue', {
        user: userLog,
        error: errorMessage,
      });
    } else if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
      failureReason = 'RPC_TIMEOUT: RPC request timed out';
      logger.executor.error('Rescue failed - RPC timeout', {
        user: userLog,
      });
    } else {
      logger.executor.error('Rescue execution failed with unexpected error', {
        user: userLog,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    return {
      success: false,
      error: failureReason,
      amountUSD,
      timestamp: Date.now(),
    };
  }
}

// ============================================================
// EXPORTS
// ============================================================

export type { ExecuteParams };
