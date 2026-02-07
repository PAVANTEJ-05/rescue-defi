/**
 * Core type definitions for Rescue.ETH
 * 
 * All policy configuration is sourced from ENS text records.
 * These types define the normalized structure after parsing.
 * 
 * PRODUCTION INVARIANTS:
 * - Rescues require explicit user consent (enabled=true)
 * - Only stablecoins are supported for rescue (price assumption = $1)
 * - Partial rescues that don't restore HF >= minHF are REJECTED
 * - Health factor validation uses derived HF when reported HF is unreliable
 */

/**
 * User rescue policy loaded from ENS text records
 * 
 * ENS keys:
 * - rescue.enabled      → enabled (REQUIRED for rescue)
 * - rescue.minHF        → minHF
 * - rescue.targetHF     → targetHF
 * - rescue.maxAmountUSD → maxAmountUSD
 * - rescue.cooldownSeconds → cooldownSeconds
 * - rescue.allowedTokens → allowedTokens (comma-separated)
 * - rescue.allowedChains → allowedChains (comma-separated)
 * 
 * CRITICAL: If ENS config is missing, DEFAULT_POLICY is used.
 * The enabled field MUST be explicitly checked - default is FALSE.
 */
export interface RescuePolicy {
  /** REQUIRED: User must explicitly enable rescue via ENS (default: false) */
  enabled: boolean;
  /** Health factor threshold that triggers rescue (e.g., 1.2) */
  minHF: number;
  /** Target health factor after rescue (e.g., 1.5) */
  targetHF: number;
  /** Maximum USD value to supply in a single rescue */
  maxAmountUSD: number;
  /** Minimum seconds between rescues for this user */
  cooldownSeconds: number;
  /** Token symbols allowed for rescue (e.g., ["USDC", "USDT"]) - MUST be stablecoins */
  allowedTokens: string[];
  /** Chain IDs where rescue is allowed (e.g., [1, 10, 8453]) */
  allowedChains: number[];
}

/**
 * User account data from Aave V3
 * 
 * CRITICAL: The healthFactor field may be derived from components
 * if the reported value from Aave is unreliable (0 or mismatched).
 * See aave/monitor.ts for the validation logic.
 */
export interface AaveAccountData {
  /** 
   * Health factor as decimal (1.0 = liquidation threshold)
   * This value is validated and may be derived from components
   * if the Aave-reported value is unreliable.
   */
  healthFactor: number;
  /** Total collateral value in USD (from Aave base currency) */
  totalCollateralUSD: number;
  /** Total debt value in USD (from Aave base currency) */
  totalDebtUSD: number;
  /** Current weighted average liquidation threshold (decimal, e.g., 0.825) */
  liquidationThreshold: number;
}

/**
 * Result of supply amount calculation
 * 
 * CRITICAL: expectedHF is used to verify the rescue will actually help.
 * If expectedHF < minHF after a capped rescue, the transaction MUST be rejected.
 */
export interface SupplyCalculation {
  /** Amount to supply in USD (0 if no action needed) */
  amountUSD: number;
  /** Expected health factor AFTER this supply is applied */
  expectedHF: number;
  /** Whether the rescue will restore HF >= minHF */
  willRestoreHealth: boolean;
  /** Reason for the calculation result */
  reason: 'healthy' | 'supply_needed' | 'capped_by_policy' | 'no_debt' | 'insufficient_cap';
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
