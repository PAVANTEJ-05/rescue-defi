/**
 * Cross-Chain Rescue Execution for Rescue.ETH
 *
 * ============================================================
 * DERIVED FROM execute.ts (SOURCE OF TRUTH)
 * ============================================================
 *
 * This module wraps the cross-chain LI.FI contractCallsQuote
 * pattern from execute.ts into a callable function for keeper
 * integration.
 *
 * FLOW (mirrors execute.ts Phase 2-3):
 * 1. Encode Aave supply() calldata for the DESTINATION chain
 * 2. Request a cross-chain contractCallsQuote from LI.FI
 * 3. Return quote for execution via RescueExecutor.executeRescue()
 *
 * The RescueExecutor contract (on source chain) handles:
 * - Pulling tokens from user (transferFrom)
 * - Approving immutable lifiRouter
 * - Forwarding calldata to LI.FI Diamond (bridge + destination call)
 *
 * This module does NOT:
 * - Detect HF breaches (keeper tick.ts handles this)
 * - Submit transactions (lifi/execute.ts handles this)
 * - Simulate with Tenderly (root execute.ts handles dev testing)
 * - Use ENS on-chain (ENS is off-chain config only)
 *
 * ============================================================
 * PRODUCTION NOTES
 * ============================================================
 * - fromAddress in the LI.FI quote MUST be the RescueExecutor
 *   contract (which holds tokens after transferFrom)
 * - toFallbackAddress receives tokens if destination call fails
 * - destAavePool must match the Aave V3 Pool on the dest chain
 * - Gas limit for Aave supply is set to 500000 (conservative)
 * ============================================================
 */

import { getContractCallsQuote } from '@lifi/sdk';
import { encodeFunctionData, parseAbi } from 'viem';
import type { LiFiQuoteResponse } from './types.js';
import { logger } from '../utils/logger.js';

// ============================================================
// AAVE SUPPLY ABI (destination chain calldata encoding)
// Mirrors execute.ts AAVE_POOL_ABI supply function
// ============================================================

const AAVE_SUPPLY_ABI = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
]);

// ============================================================
// TYPES
// ============================================================

/**
 * Cross-chain rescue configuration
 *
 * Loaded from environment variables at keeper bootstrap.
 * Values define the cross-chain rescue route (e.g., OP → Base).
 *
 * Matches execute.ts constants:
 * - destChainId        → ChainId.BAS (8453)
 * - sourceTokenAddress → OP_WETH (0x4200...0006)
 * - destTokenAddress   → BASE_WETH (0x4200...0006)
 * - amount             → 8500000000000000000 (8.5 WETH)
 * - destAavePool       → AAVE_POOL_BASE (0xA238Dd80C259a72e81d7e4664a9801593F98d1c5)
 */
export interface CrossChainConfig {
  /** Whether cross-chain rescue is enabled */
  enabled: boolean;
  /** Destination chain ID (e.g., 8453 for Base) */
  destChainId: number;
  /** Source token address on the source chain (e.g., WETH on Optimism) */
  sourceTokenAddress: string;
  /** Destination token address on the destination chain (e.g., WETH on Base) */
  destTokenAddress: string;
  /** Rescue amount in token smallest units (wei) */
  amount: bigint;
  /** Aave V3 Pool address on the destination chain */
  destAavePool: string;
}

/**
 * Parameters for building a cross-chain rescue quote
 */
export interface CrossChainQuoteParams {
  /** User address being rescued (receives Aave supply credit on dest chain) */
  userAddress: string;
  /** Source chain ID (keeper's operating chain) */
  sourceChainId: number;
  /** Destination chain ID */
  destChainId: number;
  /** Token address on source chain */
  sourceToken: string;
  /** Token address on destination chain */
  destToken: string;
  /** Amount to rescue (in token units / wei) */
  amount: bigint;
  /** Address initiating the rescue — must be executor contract address */
  fromAddress: string;
  /** Fallback address if destination call fails */
  fallbackAddress: string;
  /** Aave V3 Pool address on destination chain */
  destAavePool: string;
}

// ============================================================
// CROSS-CHAIN QUOTE BUILDER
// ============================================================

/**
 * Build a cross-chain rescue quote via LI.FI
 *
 * Implements the exact pattern from execute.ts (Phase 2-3):
 *
 *   Phase 2: Encode Aave supply() calldata for the destination chain
 *     → encodeFunctionData({ abi, functionName: 'supply', args })
 *
 *   Phase 3: Request cross-chain contractCallsQuote from LI.FI
 *     → getContractCallsQuote({ fromChain, toChain, contractCalls, ... })
 *
 * The returned quote can be passed directly to executeRescue() in
 * lifi/execute.ts — the RescueExecutor contract forwards the calldata
 * to its immutable lifiRouter, which handles bridging + dest execution.
 *
 * @param params - Cross-chain rescue parameters
 * @returns LI.FI quote response for use with executeRescue(), or null on failure
 */
export async function getCrossChainQuote(
  params: CrossChainQuoteParams
): Promise<LiFiQuoteResponse | null> {
  const {
    userAddress,
    sourceChainId,
    destChainId,
    sourceToken,
    destToken,
    amount,
    fromAddress,
    fallbackAddress,
    destAavePool,
  } = params;

  const amountStr = amount.toString();

  // ─── Phase 2: Build Aave supply calldata for destination chain ────
  // Mirrors execute.ts:
  //   const aaveSupplyCalldataBase = encodeFunctionData({
  //     abi: AAVE_POOL_ABI, functionName: 'supply',
  //     args: [BASE_WETH, AMOUNT, AAVE_USER, 0],
  //   });

  logger.rescue.info('Building Aave supply calldata for destination chain', {
    timestamp: new Date().toISOString(),
    destChain: destChainId,
    destToken: destToken.slice(0, 10) + '...',
    destAavePool: destAavePool.slice(0, 10) + '...',
    amount: amountStr,
    onBehalfOf: userAddress.slice(0, 10) + '...',
  });

  const aaveSupplyCalldata = encodeFunctionData({
    abi: AAVE_SUPPLY_ABI,
    functionName: 'supply',
    args: [
      destToken as `0x${string}`,
      amount,
      userAddress as `0x${string}`,
      0, // referralCode = 0
    ],
  });

  // ─── Phase 3: Request cross-chain contractCallsQuote from LI.FI ───
  // Mirrors execute.ts:
  //   const contractCallQuote = await getContractCallsQuote({
  //     fromAddress, fromChain, fromToken,
  //     toChain, toToken, toAmount, toFallbackAddress,
  //     contractCalls: [{ ... }],
  //   });

  logger.rescue.info('Requesting cross-chain LI.FI contractCallsQuote', {
    timestamp: new Date().toISOString(),
    route: `Chain ${sourceChainId} → Chain ${destChainId}`,
    fromToken: sourceToken.slice(0, 10) + '...',
    toToken: destToken.slice(0, 10) + '...',
    amount: amountStr,
    fromAddress: fromAddress.slice(0, 10) + '...',
    fallbackAddress: fallbackAddress.slice(0, 10) + '...',
  });

  try {
    const quote = await getContractCallsQuote({
      fromAddress,
      fromChain: sourceChainId,
      fromToken: sourceToken,
      toChain: destChainId,
      toToken: destToken,
      toAmount: amountStr,
      toFallbackAddress: fallbackAddress,
      contractCalls: [
        {
          fromAmount: amountStr,
          fromTokenAddress: destToken,        // token on destination chain
          toContractAddress: destAavePool,    // Aave V3 Pool on destination
          toContractCallData: aaveSupplyCalldata,
          toContractGasLimit: '500000',       // conservative gas for Aave supply
          toApprovalAddress: destAavePool,    // LI.FI must approve Aave Pool
        },
      ],
    });

    // Validate response — mirrors execute.ts validation:
    //   if (!contractCallQuote.transactionRequest?.data) throw ...
    //   if (!contractCallQuote.transactionRequest?.to) throw ...
    if (!quote?.transactionRequest?.data) {
      logger.rescue.error('Cross-chain quote returned no transactionRequest.data', {
        timestamp: new Date().toISOString(),
        route: `Chain ${sourceChainId} → Chain ${destChainId}`,
      });
      return null;
    }
    if (!quote?.transactionRequest?.to) {
      logger.rescue.error('Cross-chain quote returned no transactionRequest.to', {
        timestamp: new Date().toISOString(),
        route: `Chain ${sourceChainId} → Chain ${destChainId}`,
      });
      return null;
    }

    const lifiTarget = quote.transactionRequest.to;
    const lifiCalldata = quote.transactionRequest.data;

    logger.rescue.info('Cross-chain LI.FI quote received', {
      timestamp: new Date().toISOString(),
      quoteType: (quote as any).type ?? 'unknown',
      tool: (quote as any).tool ?? 'unknown',
      lifiTarget,
      calldataLength: lifiCalldata.length,
      route: `Chain ${sourceChainId} → Chain ${destChainId}`,
    });

    return {
      to: lifiTarget,
      data: lifiCalldata,
      value: quote.transactionRequest.value?.toString() ?? '0',
      estimatedOutput: (quote as any).estimate?.toAmount,
    };
  } catch (error) {
    logger.rescue.error('Failed to get cross-chain LI.FI quote', {
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      route: `Chain ${sourceChainId} → Chain ${destChainId}`,
      fromToken: sourceToken,
      toToken: destToken,
      amount: amountStr,
    });
    return null;
  }
}

// ============================================================
// CONFIGURATION LOADER
// ============================================================

/**
 * Load cross-chain rescue configuration from environment variables
 *
 * Environment variables (matching execute.ts constants):
 *
 *   CROSS_CHAIN_ENABLED=true
 *   CROSS_CHAIN_DEST_CHAIN_ID=8453            (Base)
 *   CROSS_CHAIN_SOURCE_TOKEN=0x42000...0006    (WETH on Optimism)
 *   CROSS_CHAIN_DEST_TOKEN=0x42000...0006      (WETH on Base)
 *   CROSS_CHAIN_AMOUNT=8500000000000000000     (8.5 WETH)
 *   CROSS_CHAIN_DEST_AAVE_POOL=0xA238Dd80...  (Aave V3 Pool on Base)
 *
 * @returns CrossChainConfig if valid, null if disabled or misconfigured
 */
export function loadCrossChainConfig(): CrossChainConfig | null {
  if (process.env['CROSS_CHAIN_ENABLED'] !== 'true') {
    return null;
  }

  const destChainIdStr = process.env['CROSS_CHAIN_DEST_CHAIN_ID'] || '';
  const sourceTokenAddress = process.env['CROSS_CHAIN_SOURCE_TOKEN'] || '';
  const destTokenAddress = process.env['CROSS_CHAIN_DEST_TOKEN'] || '';
  const amountStr = process.env['CROSS_CHAIN_AMOUNT'] || '';
  const destAavePool = process.env['CROSS_CHAIN_DEST_AAVE_POOL'] || '';

  const destChainId = parseInt(destChainIdStr, 10);

  // Validate all required fields are present
  if (!destChainId || isNaN(destChainId)) {
    logger.rescue.warn('CROSS_CHAIN_ENABLED=true but CROSS_CHAIN_DEST_CHAIN_ID missing/invalid');
    return null;
  }
  if (!sourceTokenAddress || !sourceTokenAddress.startsWith('0x')) {
    logger.rescue.warn('CROSS_CHAIN_ENABLED=true but CROSS_CHAIN_SOURCE_TOKEN missing/invalid');
    return null;
  }
  if (!destTokenAddress || !destTokenAddress.startsWith('0x')) {
    logger.rescue.warn('CROSS_CHAIN_ENABLED=true but CROSS_CHAIN_DEST_TOKEN missing/invalid');
    return null;
  }
  if (!amountStr) {
    logger.rescue.warn('CROSS_CHAIN_ENABLED=true but CROSS_CHAIN_AMOUNT missing');
    return null;
  }
  if (!destAavePool || !destAavePool.startsWith('0x')) {
    logger.rescue.warn('CROSS_CHAIN_ENABLED=true but CROSS_CHAIN_DEST_AAVE_POOL missing/invalid');
    return null;
  }

  try {
    const config: CrossChainConfig = {
      enabled: true,
      destChainId,
      sourceTokenAddress,
      destTokenAddress,
      amount: BigInt(amountStr),
      destAavePool,
    };

    logger.rescue.info('Cross-chain rescue config loaded', {
      destChainId: config.destChainId,
      sourceToken: config.sourceTokenAddress.slice(0, 10) + '...',
      destToken: config.destTokenAddress.slice(0, 10) + '...',
      amount: config.amount.toString(),
      destAavePool: config.destAavePool.slice(0, 10) + '...',
    });

    return config;
  } catch (error) {
    logger.rescue.error('Failed to parse cross-chain config', {
      error: error instanceof Error ? error.message : 'Unknown',
      amount: amountStr,
    });
    return null;
  }
}
