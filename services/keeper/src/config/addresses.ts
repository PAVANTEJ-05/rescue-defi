/**
 * Aave V3 Protocol Addresses
 *
 * Only the Pool contract is needed for Rescue.ETH.
 * We call getUserAccountData() for monitoring and repay() for execution.
 *
 * Source: https://docs.aave.com/developers/deployed-contracts/v3-mainnet
 */

import { CHAIN_IDS } from "./chains.js";

/**
 * Aave V3 Pool contract addresses per chain
 * These are the official deployed addresses from Aave governance.
 */
export const AAVE_POOL_ADDRESSES: Record<number, string> = {
  // Optimism: Aave V3 Pool
  [CHAIN_IDS.OPTIMISM]: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",

  // Base: Aave V3 Pool
  [CHAIN_IDS.BASE]: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
} as const;

/**
 * Helper to get Pool address for a chain
 * Returns undefined if chain is not supported
 */
export function getPoolAddress(chainId: number): string | undefined {
  return AAVE_POOL_ADDRESSES[chainId];
}
