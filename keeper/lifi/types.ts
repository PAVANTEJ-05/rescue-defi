/**
 * LI.FI Type Definitions for Rescue.ETH
 * 
 * ============================================================
 * PRODUCTION TYPES
 * ============================================================
 * These types define the interface with the LI.FI SDK.
 * 
 * The contractCallsQuote API is used to get routing + contract call
 * execution in a single transaction. This is INTENTIONAL - do not
 * replace with the standard /quote endpoint.
 * ============================================================
 */

import type { Chain } from 'viem';

/**
 * Supported chain definition with viem Chain object
 */
export interface SupportedChain {
  id: number;
  chain: Chain;
  rpcUrl: string;
  isTestnet?: boolean;
}

/**
 * Token information for balance tracking
 */
export interface TokenInfo {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUSD: string;
}

/**
 * Token balances organized by chain ID
 */
export type TokensByChain = Record<number, TokenInfo[]>;

/**
 * Contract call definition for LI.FI contractCallsQuote
 * 
 * This allows LI.FI to route tokens AND execute a contract call
 * (e.g., Aave supply()) in a single transaction on the destination chain.
 */
export interface ContractCall {
  /** Amount of tokens to use for the call (in smallest units) */
  fromAmount: string;
  /** Token address on destination chain */
  fromTokenAddress: string;
  /** Target contract to call (e.g., Aave Pool) */
  toContractAddress: string;
  /** Encoded calldata for the contract call */
  toContractCallData: string;
  /** Gas limit for the contract call */
  toContractGasLimit: string;
  /** Address that needs token approval before the call (e.g., Aave Pool) */
  toApprovalAddress?: string;
}

/**
 * Request parameters for LI.FI contractCallsQuote
 * 
 * This is the main API used by Rescue.ETH:
 * - Routes tokens from source chain to destination chain
 * - Executes a contract call (Aave supply) on arrival
 * 
 * DO NOT replace with standard getRoutes/getQuote - those do not
 * support post-bridge contract calls.
 */
export interface ContractCallsQuoteRequest {
  /** Address initiating the rescue (executor contract or keeper) */
  fromAddress: string;
  /** Source chain ID */
  fromChain: number;
  /** Source token address */
  fromToken: string;
  /** Expected amount to arrive at destination */
  toAmount: string;
  /** Destination chain ID */
  toChain: number;
  /** Destination token address */
  toToken: string;
  /** Array of contract calls to execute on destination */
  contractCalls: ContractCall[];
}

/**
 * LI.FI transaction request (subset of full response)
 * 
 * Contains the data needed to submit the transaction via viem.
 * Gas fields are intentionally omitted to let the local node estimate.
 */
export interface LiFiTransactionRequest {
  to: string;
  data: string;
  value: bigint;
  chainId: number;
  from?: string;
  // Note: gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas are 
  // stripped before submission to let viem/local node estimate
}

/**
 * Simplified LI.FI quote response for keeper integration
 * 
 * The actual response from LI.FI SDK is more complex.
 * This captures what the keeper needs.
 */
export interface LiFiQuoteResponse {
  /** Target contract address (LI.FI router) */
  to: string;
  /** Encoded transaction data */
  data: string;
  /** Native token value to send (wei as string) */
  value: string;
  /** Estimated output amount */
  estimatedOutput?: string;
}

/**
 * Execution parameters for LI.FI transaction
 */
export interface ExecuteParams {
  /** User address being rescued */
  userAddress: string;
  /** Input token address */
  tokenIn: string;
  /** Input amount in token units */
  amountIn: bigint;
  /** LI.FI quote response */
  quote: LiFiQuoteResponse;
  /** Amount in USD for logging */
  amountUSD: number;
}

/**
 * Bridge simulation parameters
 * 
 * Required because real bridges cannot see transactions on local forks.
 * This manually "delivers" tokens on the destination chain.
 */
export interface BridgeSimulationParams {
  /** Recipient address on destination chain */
  recipientAddress: string;
  /** Amount to mint/transfer (in token units) */
  amount: bigint;
  /** Token address on destination chain */
  tokenAddress: string;
  /** Destination chain ID */
  chainId: number;
}
