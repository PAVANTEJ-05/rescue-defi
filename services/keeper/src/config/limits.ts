/**
 * Safety Limits for Rescue.ETH
 *
 * These values protect the executor wallet from excessive capital deployment.
 * All values are in USD for simplicity.
 *
 * Limits exist because:
 * 1. Executor wallet has finite liquidity
 * 2. We want to cap exposure per user per execution
 * 3. Dust repayments aren't worth the gas cost
 */

/**
 * Maximum repay amount per execution (USD)
 *
 * Why $10?
 * - Reasonable cap for hackathon demo
 * - Limits exposure if something goes wrong
 * - Can be increased via ENS override for production
 */
export const MAX_REPAY_USD = 10;

/**
 * Minimum repay amount (USD)
 *
 * Why $5?
 * - Below this, gas costs exceed the benefit
 * - Filters out dust positions
 * - Prevents spam
 */
export const MIN_REPAY_USD = 0.5;

/**
 * Maximum percentage of total debt to repay in one execution
 *
 * Why 25%?
 * - Partial repay strategy (core to Rescue.ETH)
 * - Preserves capital for multiple users
 * - Reduces single-tx risk
 */
export const MAX_REPAY_PERCENT = 0.25;

/**
 * Limits configuration object for easy import
 */
export const LIMITS = {
  maxRepayUsd: MAX_REPAY_USD,
  minRepayUsd: MIN_REPAY_USD,
  maxRepayPercent: MAX_REPAY_PERCENT,
} as const;
