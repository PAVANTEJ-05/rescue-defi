/**
 * Aave V3 Repay Amount Calculator
 * Pure function for computing partial repay amounts
 * 
 * No blockchain calls - deterministic computation only
 */

/**
 * Input parameters for repay calculation
 */
export interface RepayCalculationInput {
  /** Current health factor (decimal, e.g., 1.05 means 5% above liquidation) */
  currentHealthFactor: number;
  /** Target health factor to achieve after repayment (e.g., 1.5) */
  targetHealthFactor: number;
  /** Total outstanding debt in USD */
  totalDebtUsd: number;
  /** Maximum amount the executor is willing to repay in USD */
  maxRepayUsd: number;
}

/**
 * Computes the optimal partial repay amount to bring health factor to target
 * 
 * Health Factor Formula (simplified):
 *   HF = (Collateral * LiquidationThreshold) / Debt
 * 
 * To increase HF by reducing debt:
 *   HF_new = (Collateral * LT) / (Debt - RepayAmount)
 * 
 * Solving for RepayAmount:
 *   RepayAmount = Debt - (Collateral * LT) / HF_new
 *   RepayAmount = Debt * (1 - HF_current / HF_target)
 * 
 * This is an approximation that works well for partial repayments.
 * 
 * @param input - Calculation parameters
 * @returns Repay amount in USD, bounded by constraints
 */
export function computeRepayAmount(input: RepayCalculationInput): number {
  const {
    currentHealthFactor,
    targetHealthFactor,
    totalDebtUsd,
    maxRepayUsd,
  } = input;

  // Validation: no repay needed if already healthy
  if (currentHealthFactor >= targetHealthFactor) {
    return 0;
  }

  // Validation: cannot repay if no debt
  if (totalDebtUsd <= 0) {
    return 0;
  }

  // Validation: target must be greater than current
  if (targetHealthFactor <= currentHealthFactor) {
    return 0;
  }

  // Validation: health factor must be positive
  if (currentHealthFactor <= 0 || targetHealthFactor <= 0) {
    return 0;
  }

  // Calculate required repay amount using the approximation:
  // RepayAmount = Debt * (1 - HF_current / HF_target)
  // 
  // This formula derives from:
  // HF_target = HF_current * Debt / (Debt - Repay)
  // Solving: Repay = Debt * (1 - HF_current / HF_target)
  const repayRatio = 1 - (currentHealthFactor / targetHealthFactor);
  let repayAmount = totalDebtUsd * repayRatio;

  // Apply constraints: never exceed maxRepayUsd
  repayAmount = Math.min(repayAmount, maxRepayUsd);

  // Apply constraints: never exceed total debt
  repayAmount = Math.min(repayAmount, totalDebtUsd);

  // Ensure non-negative (safety)
  repayAmount = Math.max(repayAmount, 0);

  return repayAmount;
}
