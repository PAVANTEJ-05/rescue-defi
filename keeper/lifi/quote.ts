/**
 * LI.FI Quote Fetcher
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Fetches swap/bridge routes from LI.FI REST API
 * - Returns calldata that can be executed on-chain
 * - Validates quote response structure
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT execute swaps (that's lifi/execute.ts)
 * - Does NOT supply to Aave (LI.FI doesn't know about Aave)
 * - Does NOT edit or modify calldata
 * - Does NOT simulate transactions
 * 
 * ============================================================
 * LI.FI LIMITATIONS FOR RESCUE:
 * ============================================================
 * LI.FI is designed for:
 * - Cross-chain bridging (e.g., ETH mainnet → Arbitrum)
 * - DEX aggregation (e.g., swap WETH → USDC)
 * 
 * LI.FI is NOT designed for:
 * - Same-chain, same-token transfers (returns error or no-op)
 * - Protocol-specific actions like Aave supply
 * 
 * For same-chain rescues where the user already has the correct
 * token, LI.FI adds unnecessary complexity. Consider direct
 * AavePool.supply() instead.
 * ============================================================
 * 
 * PRODUCTION RULES:
 * - Keeper fetches route + calldata
 * - Keeper NEVER edits calldata
 * - No balance mutation
 * - No bridge simulation
 */

import type { LiFiQuote } from '../config/types.js';
import { logger } from '../utils/logger.js';

/**
 * LI.FI API base URL
 */
const LIFI_API_BASE = 'https://li.quest/v1';

/**
 * LI.FI Quote Request parameters
 */
export interface QuoteRequest {
  /** Source chain ID */
  fromChain: number;
  /** Destination chain ID */
  toChain: number;
  /** Source token address (use 0x0...0 for native) */
  fromToken: string;
  /** Destination token address */
  toToken: string;
  /** Amount in smallest units (wei for ETH) */
  fromAmount: string;
  /** Address that will send the tokens */
  fromAddress: string;
  /** Address that will receive the tokens (usually same as fromAddress) */
  toAddress: string;
}

/**
 * LI.FI API response structure (simplified)
 */
interface LiFiApiResponse {
  transactionRequest?: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
  };
  estimate?: {
    toAmount: string;
    toAmountMin: string;
  };
  action?: {
    fromToken: { symbol: string };
    toToken: { symbol: string };
  };
}

/**
 * Fetch a swap/bridge quote from LI.FI
 * 
 * @param request - Quote parameters
 * @returns Quote with calldata for execution, or null on failure
 */
export async function getQuote(request: QuoteRequest): Promise<LiFiQuote | null> {
  logger.lifi.info('Fetching quote', {
    fromChain: request.fromChain,
    toChain: request.toChain,
    fromToken: request.fromToken.slice(0, 10),
    amount: request.fromAmount,
  });

  try {
    // Build query string
    const params = new URLSearchParams({
      fromChain: request.fromChain.toString(),
      toChain: request.toChain.toString(),
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.fromAmount,
      fromAddress: request.fromAddress,
      toAddress: request.toAddress,
      // Request transaction data directly
      order: 'RECOMMENDED',
      slippage: '0.03', // 3% slippage tolerance
      allowBridges: 'stargate,hop,across,cbridge', // Popular bridges
      allowExchanges: 'all',
    });

    const url = `${LIFI_API_BASE}/quote?${params.toString()}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.lifi.error('LI.FI API error', {
        status: response.status,
        error: errorText.slice(0, 200),
      });
      return null;
    }

    const data: LiFiApiResponse = await response.json() as LiFiApiResponse;

    // Validate response has transaction data
    if (!data.transactionRequest) {
      logger.lifi.error('No transaction data in LI.FI response');
      return null;
    }

    const quote: LiFiQuote = {
      to: data.transactionRequest.to,
      data: data.transactionRequest.data,
      value: data.transactionRequest.value || '0',
      estimatedOutput: data.estimate?.toAmountMin || '0',
    };

    logger.lifi.info('Quote received', {
      router: quote.to.slice(0, 10),
      estimatedOutput: quote.estimatedOutput,
      valueWei: quote.value,
    });

    return quote;
  } catch (error) {
    logger.lifi.error('Failed to fetch quote', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Get quote for same-chain swap (simpler case)
 */
export async function getSameChainQuote(
  chainId: number,
  fromToken: string,
  toToken: string,
  amount: string,
  userAddress: string
): Promise<LiFiQuote | null> {
  return getQuote({
    fromChain: chainId,
    toChain: chainId,
    fromToken,
    toToken,
    fromAmount: amount,
    fromAddress: userAddress,
    toAddress: userAddress,
  });
}

/**
 * Validate that a quote target is the expected LI.FI router
 */
export function isValidQuoteTarget(quote: LiFiQuote, expectedRouter: string): boolean {
  return quote.to.toLowerCase() === expectedRouter.toLowerCase();
}
