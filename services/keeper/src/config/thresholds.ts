/**
 * Risk Thresholds for Rescue.ETH
 *
 * These values define WHEN the keeper should act.
 * Health Factor (HF) = 1.0 means liquidation is imminent.
 *
 * Strategy:
 * - Trigger below 1.2 (20% buffer before liquidation)
 * - Target 1.5 after repay (safe zone with room for volatility)
 */

/**
 * Health factor at which rescue is triggered
 *
 * Why 1.2?
 * - Gives ~20% margin before liquidation (HF=1.0)
 * - Early enough to act before price volatility worsens the position
 * - Not so early that we waste gas on healthy positions
 */
export const TRIGGER_HEALTH_FACTOR = 1.2;

/**
 * Target health factor after partial repay
 *
 * Why 1.5?
 * - Provides 50% buffer above liquidation threshold
 * - Accounts for continued price movement during tx confirmation
 * - Balances capital efficiency with safety
 */
export const TARGET_HEALTH_FACTOR = 1.5;

/**
 * Critical health factor (emergency mode)
 * Below this, we use maximum allowed repay amount
 */
export const CRITICAL_HEALTH_FACTOR = 1.05;

/**
 * Threshold configuration object for easy import
 */
export const THRESHOLDS = {
  trigger: TRIGGER_HEALTH_FACTOR,
  target: TARGET_HEALTH_FACTOR,
  critical: CRITICAL_HEALTH_FACTOR,
} as const;
