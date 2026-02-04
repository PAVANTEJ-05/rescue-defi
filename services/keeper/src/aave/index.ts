/**
 * Aave V3 Integration Module
 * 
 * Public API for Rescue.ETH keeper service
 * 
 * Responsibilities:
 * - Monitor user health factor and debt
 * - Compute optimal partial repay amounts
 * - Execute debt repayments on behalf of users
 */

// Re-export core functions for clean public API
export { getUserRisk, type UserRiskData } from "./monitor.js";
export { computeRepayAmount, type RepayCalculationInput } from "./repayMath.js";
export { executeRepay, type RepayParams, type RepayResult } from "./executor.js";

// Re-export pool utilities for advanced usage
export { getAavePool, getERC20, AAVE_POOL_ABI, ERC20_ABI } from "./pool.js";
