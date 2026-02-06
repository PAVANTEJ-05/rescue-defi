/**
 * LI.FI Quote Module for Rescue.ETH
 * 
 * ============================================================
 * CRITICAL: DO NOT MODIFY QUOTE LOGIC
 * ============================================================
 * This module uses contractCallsQuote, NOT the standard getRoutes/getQuote.
 * 
 * WHY contractCallsQuote:
 * - Standard LI.FI routes only move tokens between chains/dexes
 * - contractCallsQuote allows executing a contract call AFTER the bridge
 * - This is how we call Aave's supply() on the destination chain
 * 
 * The flow:
 * 1. User has USDC on mainnet
 * 2. contractCallsQuote bridges USDC to Base
 * 3. On arrival, it calls AavePool.supply() with the USDC
 * 4. User's Aave health factor is restored
 * 
 * Without contractCallsQuote, tokens would arrive but NOT be deposited
 * into Aave, defeating the purpose of the rescue.
 * ============================================================
 */

import { getContractCallsQuote } from '@lifi/sdk';
import { encodeFunctionData, parseAbi } from 'viem';
import type { ContractCallsQuoteRequest, LiFiQuoteResponse } from './types.js';

// ============================================================
// AAVE CONFIGURATION
// ============================================================

/**
 * USDC address on Base (destination token)
 */
export const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * Aave V3 Pool address on Base
 * This is where supply() will be called
 */
export const AAVE_POOL_ADDRESS = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

/**
 * Aave V3 Pool ABI (minimal subset for supply)
 * 
 * The supply function deposits collateral on behalf of a user.
 * Parameters:
 * - asset: Token to supply (USDC)
 * - amount: Amount in token units
 * - onBehalfOf: User receiving the collateral credit
 * - referralCode: Set to 0 (no referral)
 */
export const AAVE_POOL_ABI = parseAbi([
  // Read: Get user's aggregate position data
  'function getUserAccountData(address user) view returns (' +
    'uint256 totalCollateralBase,' +
    'uint256 totalDebtBase,' +
    'uint256 availableBorrowsBase,' +
    'uint256 currentLiquidationThreshold,' +
    'uint256 ltv,' +
    'uint256 healthFactor' +
    ')',

  // Write: Supply collateral
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
]);

// ============================================================
// CALLDATA ENCODING
// ============================================================

/**
 * Encode Aave supply() calldata
 * 
 * This creates the data payload that LI.FI will execute on Base
 * after the bridge completes.
 * 
 * @param tokenAddress - Token to supply (e.g., USDC on Base)
 * @param amount - Amount in token units (e.g., 8500000 = 8.5 USDC)
 * @param onBehalfOf - User address receiving collateral credit
 * @returns Encoded calldata as hex string
 */
export function encodeAaveSupplyCalldata(
  tokenAddress: `0x${string}`,
  amount: bigint,
  onBehalfOf: `0x${string}`
): `0x${string}` {
  return encodeFunctionData({
    abi: AAVE_POOL_ABI,
    functionName: 'supply',
    args: [tokenAddress, amount, onBehalfOf, 0], // referralCode = 0
  });
}

// ============================================================
// QUOTE FUNCTIONS
// ============================================================

/**
 * Parameters for creating a contract calls quote request
 */
export interface QuoteParams {
  /** Address initiating the rescue */
  fromAddress: `0x${string}`;
  /** Source chain ID */
  fromChain: number;
  /** Source token address */
  fromToken: `0x${string}`;
  /** Amount to send (in token units as string) */
  fromAmount: string;
  /** Destination chain ID */
  toChain: number;
  /** Destination token address */
  toToken: `0x${string}`;
  /** User address to receive Aave collateral credit */
  beneficiary: `0x${string}`;
}

/**
 * Build a contract calls quote request for Aave supply
 * 
 * This constructs the full request payload for LI.FI's contractCallsQuote API.
 * The request includes both the bridge parameters AND the contract call to execute.
 * 
 * @param params - Quote parameters
 * @returns Formatted request object for getContractCallsQuote
 */
export function buildContractCallsQuoteRequest(params: QuoteParams): ContractCallsQuoteRequest {
  const {
    fromAddress,
    fromChain,
    fromToken,
    fromAmount,
    toChain,
    toToken,
    beneficiary,
  } = params;

  // Encode the Aave supply calldata
  const supplyCalldata = encodeAaveSupplyCalldata(
    toToken,
    BigInt(fromAmount),
    beneficiary
  );

  return {
    fromAddress,
    fromChain,
    fromToken,
    toAmount: fromAmount, // Expected output equals input for stablecoin bridges
    toChain,
    toToken,
    contractCalls: [
      {
        fromAmount,
        fromTokenAddress: toToken, // Token on destination chain
        toContractAddress: AAVE_POOL_ADDRESS,
        toContractCallData: supplyCalldata,
        toContractGasLimit: '500000', // Conservative gas limit for Aave supply
      },
    ],
  };
}

/**
 * Fetch a contract calls quote from LI.FI
 * 
 * This is the main entry point for getting a rescue quote.
 * The quote contains all the routing info + contract call execution data.
 * 
 * @param request - The contract calls quote request
 * @returns Quote response with transaction data, or null on failure
 */
export async function fetchContractCallsQuote(
  request: ContractCallsQuoteRequest
): Promise<any> {
  try {
    const quote = await getContractCallsQuote(request);
    return quote;
  } catch (error) {
    console.error('Failed to fetch contract calls quote:', error);
    return null;
  }
}

// ============================================================
// KEEPER INTEGRATION
// ============================================================

/**
 * Quote request parameters for keeper integration
 * (Aligned with keeper/index.ts expectations)
 */
export interface GetQuoteParams {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress: string;
}

/**
 * Get a LI.FI quote for the keeper
 * 
 * This function is designed to match the interface expected by keeper/index.ts.
 * It wraps the contract calls quote logic for simple integration.
 * 
 * @param params - Quote parameters
 * @returns Simplified quote response for keeper use
 */
export async function getQuote(params: GetQuoteParams): Promise<LiFiQuoteResponse | null> {
  try {
    // Build the contract calls quote request
    const request = buildContractCallsQuoteRequest({
      fromAddress: params.fromAddress as `0x${string}`,
      fromChain: params.fromChain,
      fromToken: params.fromToken as `0x${string}`,
      fromAmount: params.fromAmount,
      toChain: params.toChain,
      toToken: params.toToken as `0x${string}`,
      beneficiary: params.toAddress as `0x${string}`,
    });

    const quote = await fetchContractCallsQuote(request);
    if (!quote?.transactionRequest) {
      return null;
    }

    // Extract what the keeper needs
    return {
      to: quote.transactionRequest.to,
      data: quote.transactionRequest.data,
      value: quote.transactionRequest.value?.toString() ?? '0',
      estimatedOutput: quote.estimate?.toAmount,
    };
  } catch (error) {
    console.error('getQuote failed:', error);
    return null;
  }
}

/**
 * Validate that a quote targets the expected LI.FI router
 * 
 * Security check: Ensure we're sending funds to the official LI.FI contract,
 * not a malicious address returned by a compromised API.
 * 
 * @param quote - The quote response
 * @param expectedRouter - Expected LI.FI router address
 * @returns True if quote target matches expected router
 */
export function isValidQuoteTarget(quote: LiFiQuoteResponse, expectedRouter: string): boolean {
  return quote.to.toLowerCase() === expectedRouter.toLowerCase();
}
