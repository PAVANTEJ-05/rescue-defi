/**
 * Rescue.ETH Configuration
 *
 * Centralized configuration for the keeper service.
 * All modules import config from here — never from individual files.
 *
 * These are default values. ENS can override thresholds and limits at runtime.
 */

// Chain configuration
export {
  CHAIN_IDS,
  SUPPORTED_CHAINS,
  SUPPORTED_CHAIN_IDS,
  type ChainConfig,
} from "./chains.js";

// Aave contract addresses
export { AAVE_POOL_ADDRESSES, getPoolAddress } from "./addresses.js";

// Risk thresholds (when to act)
export {
  TRIGGER_HEALTH_FACTOR,
  TARGET_HEALTH_FACTOR,
  CRITICAL_HEALTH_FACTOR,
  THRESHOLDS,
} from "./thresholds.js";

// Safety limits (how much to act)
export {
  MAX_REPAY_USD,
  MIN_REPAY_USD,
  MAX_REPAY_PERCENT,
  LIMITS,
} from "./limits.js";
