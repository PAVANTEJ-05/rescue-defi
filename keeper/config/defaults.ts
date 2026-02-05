/**
 * Default policy values for Rescue.ETH
 * 
 * Used ONLY when ENS text records are missing (demo/testing safety).
 * Production users MUST set their own ENS configuration.
 * 
 * These defaults are conservative to prevent unexpected behavior.
 */

import type { RescuePolicy } from './types.js';

/**
 * Default rescue policy
 * 
 * Values chosen for safety:
 * - minHF 1.2: Trigger early (20% above liquidation)
 * - targetHF 1.6: Comfortable buffer after rescue
 * - maxAmountUSD 10: Small cap for demo safety
 * - cooldownSeconds 10800: 3 hours between rescues
 * - allowedTokens: Common stablecoins and ETH
 * - allowedChains: Mainnet + major L2s
 */
export const DEFAULT_POLICY: RescuePolicy = {
  minHF: 1.2,
  targetHF: 1.5,
  maxAmountUSD: 10,
  cooldownSeconds: 500, // ~8 minutes
  allowedTokens: ['USDC', 'USDT', 'DAI', 'ETH', 'WETH'],
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
