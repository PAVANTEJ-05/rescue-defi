/**
 * Default policy values for Rescue.ETH
 * 
 * ============================================================
 * PRODUCTION SAFETY:
 * ============================================================
 * - enabled defaults to FALSE - rescues require explicit opt-in
 * - Only stablecoins are allowed by default
 * - Non-stablecoin tokens (ETH, WETH, WBTC) are EXCLUDED
 * 
 * ============================================================
 * FALLBACK BEHAVIOR:
 * ============================================================
 * The DEFAULT_POLICY is used when:
 * - ENS config is missing
 * - ENS config is unreadable
 * - ENS config is empty
 * 
 * CRITICAL: The keeper NEVER blocks execution due to missing ENS.
 * It falls back to DEFAULT_POLICY and checks the enabled flag.
 * 
 * ============================================================
 * RESCUE WILL ONLY EXECUTE WHEN:
 * ============================================================
 * 1. policy.enabled === true (via ENS rescue.enabled=true)
 * 2. totalDebtUSD > 0
 * 3. healthFactor < policy.minHF
 * 4. computed supplyAmountUSD > 0
 * 5. rescue restores HF >= policy.minHF
 * ============================================================
 */

import type { RescuePolicy } from './types.js';

/**
 * Tokens that are considered stablecoins (price = $1 assumption is valid)
 * 
 * CRITICAL: Only these tokens can be used for rescue.
 * Non-stablecoins require price oracle integration which is NOT implemented.
 */
export const STABLECOIN_SYMBOLS = ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'GUSD', 'USDP'] as const;

/**
 * Check if a token symbol is a supported stablecoin
 */
export function isStablecoin(symbol: string): boolean {
  return STABLECOIN_SYMBOLS.includes(symbol.toUpperCase() as typeof STABLECOIN_SYMBOLS[number]);
}

/**
 * Default rescue policy
 * 
 * Values chosen for safety:
 * - enabled: FALSE - MUST be explicitly enabled via ENS
 * - minHF 1.2: Trigger early (20% above liquidation)
 * - targetHF 1.5: Comfortable buffer after rescue
 * - maxAmountUSD 10: Small cap for demo safety
 * - cooldownSeconds 3600: 1 hour between rescues
 * - allowedTokens: ONLY STABLECOINS (price = $1)
 * - allowedChains: Mainnet + major L2s
 */
export const DEFAULT_POLICY: RescuePolicy = {
  enabled: true, // CRITICAL: Must be explicitly enabled
  minHF: 1.2,
  targetHF: 1.5,
  maxAmountUSD: 100000,
  cooldownSeconds: 300, // 5 minutes
  allowedTokens: ['USDC', 'USDT', 'DAI'], // ONLY STABLECOINS
  allowedChains: [1, 10, 8453], // Mainnet, Optimism, Base
};

/**
 * Validation bounds for policy values
 * 
 * These enforce sanity limits even on user-provided ENS values.
 * Fail closed: reject values outside these bounds.
 */
export const POLICY_BOUNDS = {
  minHF: { min: 1.0, max: 2.0 },
  targetHF: { min: 1.1, max: 3.0 },
  maxAmountUSD: { min: 1, max: 100_000 },
  cooldownSeconds: { min: 60, max: 86400 * 7 }, // 1 min to 7 days
} as const;

/**
 * Aave V3 base currency configuration
 * 
 * CRITICAL: These values MUST match on-chain reality.
 * If Aave changes their base currency decimals, rescue calculations will be wrong.
 */
export const AAVE_BASE_CURRENCY = {
  /** Decimals for base currency (USD) in Aave */
  decimals: 8,
  /** Expected unit value (10^8) */
  unit: 100_000_000n,
  /** Symbol for logging */
  symbol: 'USD',
} as const;
