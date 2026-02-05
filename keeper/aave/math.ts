/**
 * Supply Amount Calculator for Rescue.ETH
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Pure math functions (no blockchain calls)
 * - Calculates MINIMUM collateral needed to reach target health factor
 * - Applies policy caps (maxAmountUSD)
 * - Estimates resulting health factor
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT call any contracts
 * - Does NOT handle repay (supply-only)
 * - Does NOT consider token prices (assumes USD inputs)
 * - Does NOT consider gas costs
 * 
 * ============================================================
 * THE FORMULA:
 * ============================================================
 * Aave V3 Health Factor:
 * 
 *   HF = (CollateralUSD × LiquidationThreshold) / DebtUSD
 * 
 * To reach a target HF by supplying collateral:
 * 
 *   targetHF = ((CurrentCollateral + SupplyAmount) × LT) / DebtUSD
 * 
 * Solving for SupplyAmount:
 * 
 *   SupplyAmount = (targetHF × DebtUSD / LT) - CurrentCollateral
 * 
 * This gives the EXACT minimum amount needed.
 * ============================================================
 * 
 * CRITICAL: This is supply-only math. NO repay logic.
 */

import type { AaveAccountData, SupplyCalculation, RescuePolicy } from '../config/types.js';
import { logger } from '../utils/logger.js';

/**
 * Health Factor Formula (Aave V3):
 * 
 *   HF = (CollateralUSD × LiquidationThreshold) / DebtUSD
 * 
 * To reach a target HF by supplying additional collateral:
 * 
 *   targetHF = ((CurrentCollateral + SupplyAmount) × LT) / DebtUSD
 * 
 * Solving for SupplyAmount:
 * 
 *   SupplyAmount = (targetHF × DebtUSD / LT) - CurrentCollateral
 * 
 * This gives the EXACT amount needed - we never oversupply.
 */

/**
 * Compute the minimum collateral amount (USD) required to reach target HF
 * 
 * @param accountData - Current Aave position data
 * @param policy - User's rescue policy from ENS
 * @returns Supply calculation with amount and reason
 */
export function computeRequiredSupply(
  accountData: AaveAccountData,
  policy: RescuePolicy
): SupplyCalculation {
  const { healthFactor, totalCollateralUSD, totalDebtUSD, liquidationThreshold } = accountData;
  const { minHF, targetHF, maxAmountUSD } = policy;

  // Case 1: No debt = no liquidation risk
  if (totalDebtUSD <= 0) {
    logger.aave.debug('No debt, no supply needed');
    return { amountUSD: 0, reason: 'no_debt' };
  }

  // Case 2: Already healthy (HF >= minHF)
  if (healthFactor >= minHF) {
    logger.aave.debug('Position healthy', { hf: healthFactor, minHF });
    return { amountUSD: 0, reason: 'healthy' };
  }

  // Case 3: Need to supply collateral
  // Formula: SupplyAmount = (targetHF × DebtUSD / LT) - CurrentCollateral
  const requiredTotalCollateral = (targetHF * totalDebtUSD) / liquidationThreshold;
  const rawSupplyAmount = requiredTotalCollateral - totalCollateralUSD;

  // Safety: If calculation gives negative (shouldn't happen), return 0
  if (rawSupplyAmount <= 0) {
    logger.aave.warn('Negative supply calculation, returning 0', {
      rawSupplyAmount,
      targetHF,
      totalDebtUSD,
      liquidationThreshold,
      totalCollateralUSD,
    });
    return { amountUSD: 0, reason: 'healthy' };
  }

  // Apply policy cap - never exceed user's maxAmountUSD
  const cappedAmount = Math.min(rawSupplyAmount, maxAmountUSD);
  const wasCapped = cappedAmount < rawSupplyAmount;

  logger.aave.info('Supply calculation complete', {
    currentHF: healthFactor.toFixed(4),
    targetHF,
    rawAmountUSD: rawSupplyAmount.toFixed(2),
    cappedAmountUSD: cappedAmount.toFixed(2),
    wasCapped,
  });

  return {
    amountUSD: cappedAmount,
    reason: wasCapped ? 'capped_by_policy' : 'supply_needed',
  };
}

/**
 * Estimate new health factor after supply
 * 
 * Useful for logging and verification.
 * 
 * @param accountData - Current position
 * @param supplyAmountUSD - Amount being supplied
 * @returns Estimated new health factor
 */
export function estimateNewHealthFactor(
  accountData: AaveAccountData,
  supplyAmountUSD: number
): number {
  const { totalCollateralUSD, totalDebtUSD, liquidationThreshold } = accountData;

  if (totalDebtUSD <= 0) return Infinity;

  const newCollateral = totalCollateralUSD + supplyAmountUSD;
  const newHF = (newCollateral * liquidationThreshold) / totalDebtUSD;

  return newHF;
}

/**
 * Validate that a supply amount is within safe bounds
 * 
 * @param amountUSD - Proposed supply amount
 * @param policy - User's rescue policy
 * @returns true if amount is valid
 */
export function isValidSupplyAmount(amountUSD: number, policy: RescuePolicy): boolean {
  // Must be positive
  if (amountUSD <= 0) return false;

  // Must not exceed policy cap
  if (amountUSD > policy.maxAmountUSD) return false;

  return true;
}
