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
 * - REJECTS rescues that won't restore HF >= minHF
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
 * CRITICAL SAFETY:
 * - If capped amount results in expectedHF < minHF, the rescue is REJECTED
 * - This prevents infinite rescue loops where partial rescues never help
 * ============================================================
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
 * Estimate health factor after supplying additional collateral
 * 
 * Pure math function - no side effects.
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
 * Compute the minimum collateral amount (USD) required to reach target HF
 * 
 * CRITICAL SAFETY FEATURES:
 * 1. Calculates EXACT minimum supply needed
 * 2. Applies policy cap (maxAmountUSD)
 * 3. Computes expectedHF AFTER capping
 * 4. If expectedHF < minHF, marks rescue as insufficient (will be rejected)
 * 
 * This prevents:
 * - Oversupplying collateral
 * - Infinite rescue loops from capped partial rescues
 * 
 * @param accountData - Current Aave position data
 * @param policy - User's rescue policy from ENS
 * @returns Supply calculation with amount, expectedHF, and reason
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
    return { 
      amountUSD: 0, 
      expectedHF: Infinity, 
      willRestoreHealth: true,
      reason: 'no_debt' 
    };
  }

  // Case 2: Already healthy (HF >= minHF)
  if (healthFactor >= minHF) {
    logger.aave.debug('Position healthy', { hf: healthFactor, minHF });
    return { 
      amountUSD: 0, 
      expectedHF: healthFactor, 
      willRestoreHealth: true,
      reason: 'healthy' 
    };
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
    return { 
      amountUSD: 0, 
      expectedHF: healthFactor, 
      willRestoreHealth: true,
      reason: 'healthy' 
    };
  }

  // Apply policy cap - never exceed user's maxAmountUSD
  const cappedAmount = Math.min(rawSupplyAmount, maxAmountUSD);
  const wasCapped = cappedAmount < rawSupplyAmount;

  // CRITICAL: Calculate expected HF AFTER capping
  const expectedHF = estimateNewHealthFactor(accountData, cappedAmount);
  const willRestoreHealth = expectedHF >= minHF;

  // Determine reason based on whether capping affects safety
  let reason: SupplyCalculation['reason'];
  if (!willRestoreHealth) {
    // This is the RESCUE LOOP PREVENTION case
    // The capped amount won't restore HF >= minHF
    reason = 'insufficient_cap';
    logger.aave.warn('RESCUE REJECTED: Capped amount insufficient to restore health', {
      currentHF: healthFactor.toFixed(4),
      minHF,
      targetHF,
      rawAmountUSD: rawSupplyAmount.toFixed(2),
      cappedAmountUSD: cappedAmount.toFixed(2),
      expectedHF: expectedHF.toFixed(4),
      maxAmountUSD,
    });
  } else if (wasCapped) {
    reason = 'capped_by_policy';
    logger.aave.info('Supply capped but will restore health', {
      currentHF: healthFactor.toFixed(4),
      rawAmountUSD: rawSupplyAmount.toFixed(2),
      cappedAmountUSD: cappedAmount.toFixed(2),
      expectedHF: expectedHF.toFixed(4),
    });
  } else {
    reason = 'supply_needed';
    logger.aave.info('Supply calculation complete', {
      currentHF: healthFactor.toFixed(4),
      targetHF,
      amountUSD: cappedAmount.toFixed(2),
      expectedHF: expectedHF.toFixed(4),
    });
  }

  return {
    amountUSD: cappedAmount,
    expectedHF,
    willRestoreHealth,
    reason,
  };
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
