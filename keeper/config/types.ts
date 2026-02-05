/**
 * Core type definitions for Rescue.ETH
 * 
 * All policy configuration is sourced from ENS text records.
 * These types define the normalized structure after parsing.
 */

/**
 * User rescue policy loaded from ENS text records
 * 
 * ENS keys:
 * - rescue.minHF        → minHF
 * - rescue.targetHF     → targetHF
 * - rescue.maxAmountUSD → maxAmountUSD
 * - rescue.cooldownSeconds → cooldownSeconds
 * - rescue.allowedTokens → allowedTokens (comma-separated)
 * - rescue.allowedChains → allowedChains (comma-separated)
 */
export interface RescuePolicy {
  /** Health factor threshold that triggers rescue (e.g., 1.2) */
  minHF: number;
  /** Target health factor after rescue (e.g., 1.6) */
  targetHF: number;
  /** Maximum USD value to supply in a single rescue */
  maxAmountUSD: number;
  /** Minimum seconds between rescues for this user */
  cooldownSeconds: number;
  /** Token symbols allowed for rescue (e.g., ["USDC", "ETH"]) */
  allowedTokens: string[];
  /** Chain IDs where rescue is allowed (e.g., [1, 10, 8453]) */
  allowedChains: number[];
}

/**
 * User account data from Aave V3
 */
export interface AaveAccountData {
  /** Health factor as decimal (1.0 = liquidation threshold) */
  healthFactor: number;
  /** Total collateral value in USD */
  totalCollateralUSD: number;
  /** Total debt value in USD */
  totalDebtUSD: number;
  /** Current liquidation threshold (decimal, e.g., 0.825) */
  liquidationThreshold: number;
}

/**
 * Result of supply amount calculation
 */
export interface SupplyCalculation {
  /** Amount to supply in USD (0 if no action needed) */
  amountUSD: number;
  /** Reason for the calculation result */
  reason: 'healthy' | 'supply_needed' | 'capped_by_policy' | 'no_debt';
}

/**
 * LI.FI route quote response (simplified)
 */
export interface LiFiQuote {
  /** Target contract address (must be LI.FI router) */
  to: string;
  /** Encoded calldata for the swap/bridge */
  data: string;
  /** Native token value to send (wei as string) */
  value: string;
  /** Estimated output amount */
  estimatedOutput: string;
}

/**
 * User to monitor with their ENS name
 */
export interface MonitoredUser {
  /** User's wallet address */
  address: string;
  /** User's ENS name (used to fetch policy) */
  ensName: string;
}

/**
 * Execution result from RescueExecutor
 */
export interface RescueResult {
  /** Whether the rescue succeeded */
  success: boolean;
  /** Transaction hash if successful */
  txHash?: string;
  /** Error message if failed */
  error?: string;
  /** Amount supplied in USD */
  amountUSD: number;
  /** Timestamp of execution */
  timestamp: number;
}
