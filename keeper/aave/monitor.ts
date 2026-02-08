/**
 * Aave V3 Position Monitoring
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Reads user position data from Aave V3 Pool contract
 * - Normalizes raw Aave data (RAY, base currency) to human-readable formats
 * - Provides helper functions to assess position risk
 * - Validates Aave base currency assumptions
 * - CRITICAL: Derives health factor from components when reported HF is unreliable
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT write to Aave (no supply, no repay)
 * - Does NOT manage approvals
 * - Does NOT fetch token prices (Aave provides USD values)
 * 
 * ============================================================
 * ASSUMPTIONS (VALIDATED AT RUNTIME):
 * ============================================================
 * - Provider is connected to the correct chain
 * - Pool address is a valid Aave V3 Pool
 * - User has an Aave position (may be zero)
 * - Base currency uses 8 decimals (USD)
 * 
 * ============================================================
 * HEALTH FACTOR VALIDATION:
 * ============================================================
 * CRITICAL: The reported health factor from Aave may be unreliable due to:
 * 1. Precision loss during BigInt → Number conversion
 * 2. Edge cases in Aave's internal calculations
 * 
 * This module:
 * 1. Parses reported HF using safe BigInt scaling
 * 2. Computes derived HF: (collateral × LT) / debt
 * 3. Compares reported vs derived
 * 4. Uses derived HF if: reportedHF === 0 OR |diff| > epsilon
 * 5. Logs warnings when mismatch is detected
 * ============================================================
 */

import type { Provider } from 'ethers';
import { getAavePool } from './pool.js';
import type { AaveAccountData } from '../config/types.js';
import { AAVE_BASE_CURRENCY } from '../config/defaults.js';
import { rayToDecimal, wadToDecimal, baseCurrencyToUsd, bpsToDecimal } from '../utils/units.js';
import { logger } from '../utils/logger.js';

/**
 * Health factor validation epsilon
 * If |reportedHF - derivedHF| > EPSILON, prefer derived HF
 */
const HF_MISMATCH_EPSILON = 0.05;

/**
 * Raw response from Aave getUserAccountData
 * All values are in Aave's internal representations
 */
interface RawAccountData {
  /** Total collateral in base currency units (8 decimals for USD) */
  totalCollateralBase: bigint;
  /** Total debt in base currency units */
  totalDebtBase: bigint;
  /** Available borrows in base currency units */
  availableBorrowsBase: bigint;
  /** Weighted average liquidation threshold in basis points (e.g., 8250 = 82.5%) */
  currentLiquidationThreshold: bigint;
  /** Weighted average LTV in basis points */
  ltv: bigint;
  /** Health factor in RAY (1e27). HF < 1e27 means liquidatable */
  healthFactor: bigint;
}

/**
 * Compute derived health factor from position components
 * 
 * Formula: HF = (CollateralUSD × LiquidationThreshold) / DebtUSD
 * 
 * This is the source of truth when reported HF is unreliable.
 * 
 * @param collateralUSD - Total collateral value in USD
 * @param debtUSD - Total debt value in USD
 * @param liquidationThreshold - Weighted average LT (decimal, e.g., 0.825)
 * @returns Derived health factor
 */
export function computeDerivedHealthFactor(
  collateralUSD: number,
  debtUSD: number,
  liquidationThreshold: number
): number {
  if (debtUSD <= 0) {
    return Infinity; // No debt = infinite health factor
  }
  if (collateralUSD <= 0) {
    return 0; // No collateral with debt = immediate liquidation
  }
  return (collateralUSD * liquidationThreshold) / debtUSD;
}

/**
 * Validate and select the most reliable health factor
 * 
 * CRITICAL SAFETY FUNCTION:
 * - If reportedHF === 0 → USE derived HF (parsing failure)
 * - If |reportedHF - derivedHF| > epsilon → USE derived HF (data mismatch)
 * - Otherwise → USE reported HF (Aave is authoritative)
 * 
 * @param reportedHF - Health factor from Aave (after RAY conversion)
 * @param derivedHF - Health factor computed from components
 * @param userAddress - For logging
 * @returns The health factor to use (and whether it was derived)
 */
function selectHealthFactor(
  reportedHF: number,
  derivedHF: number,
  userAddress: string
): { healthFactor: number; usedDerived: boolean } {
  const userLog = userAddress.slice(0, 10) + '...';

  // Case 1: Reported HF is zero (parsing/conversion failure)
  if (reportedHF === 0 || !Number.isFinite(reportedHF)) {
    logger.aave.warn('HEALTH FACTOR FIX: Reported HF is invalid, using derived value', {
      user: userLog,
      reportedHF,
      derivedHF: derivedHF.toFixed(6),
      reason: 'Reported HF is zero or non-finite (likely parsing failure)',
    });
    return { healthFactor: derivedHF, usedDerived: true };
  }

  // Case 2: Both are Infinity (no debt scenario)
  if (!Number.isFinite(reportedHF) && !Number.isFinite(derivedHF)) {
    return { healthFactor: Infinity, usedDerived: false };
  }

  // Case 3: Check for significant mismatch
  const diff = Math.abs(reportedHF - derivedHF);
  if (diff > HF_MISMATCH_EPSILON) {
    // Use relative comparison for larger values
    const relativeError = diff / Math.max(reportedHF, derivedHF);
    
    if (relativeError > 0.03) { // More than 3% relative error
      logger.aave.warn('HEALTH FACTOR MISMATCH: Using derived value as source of truth', {
        user: userLog,
        reportedHF: reportedHF.toFixed(6),
        derivedHF: derivedHF.toFixed(6),
        absoluteDiff: diff.toFixed(6),
        relativeError: (relativeError * 100).toFixed(2) + '%',
        reason: 'Reported HF differs significantly from derived calculation',
      });
      return { healthFactor: derivedHF, usedDerived: true };
    }
  }

  // Case 4: Values match (within tolerance), use reported (Aave authoritative)
  return { healthFactor: reportedHF, usedDerived: false };
}

/**
 * Fetch user's Aave position data
 * 
 * Calls Aave Pool.getUserAccountData() and normalizes the response.
 * 
 * CRITICAL: This function implements the health factor validation logic:
 * 1. Parse raw HF from RAY using safe BigInt scaling
 * 2. Compute derived HF from collateral, debt, and LT
 * 3. Compare and select the most reliable value
 * 4. Log warnings when mismatches are detected
 * 
 * @param poolAddress - Aave V3 Pool contract address
 * @param userAddress - Address of the user to monitor
 * @param provider - Ethers provider for read-only calls
 * @returns Normalized account data or null if fetch fails
 */
export async function getUserAccountData(
  poolAddress: string,
  userAddress: string,
  provider: Provider
): Promise<AaveAccountData | null> {
  try {
    const pool = getAavePool(poolAddress, provider);
    
    const raw: RawAccountData = await (pool.getUserAccountData as (user: string) => Promise<RawAccountData>)(userAddress);
    
    // Validate raw data sanity
    if (raw.healthFactor < 0n) {
      logger.aave.error('Invalid health factor (negative)', { user: userAddress });
      return null;
    }

    // Convert from Aave's internal representations:
    // - collateral/debt: base currency (1e8) → USD number
    // - liquidationThreshold: basis points → decimal
    const totalCollateralUSD = baseCurrencyToUsd(raw.totalCollateralBase);
    const totalDebtUSD = baseCurrencyToUsd(raw.totalDebtBase);
    const liquidationThreshold = bpsToDecimal(raw.currentLiquidationThreshold);

    // Sanity check: liquidation threshold should be between 0 and 1
    if (liquidationThreshold < 0 || liquidationThreshold > 1) {
      logger.aave.error('Invalid liquidation threshold', { 
        user: userAddress, 
        lt: liquidationThreshold,
        rawLt: raw.currentLiquidationThreshold.toString(),
      });
      return null;
    }

    // CRITICAL: Parse reported HF using safe BigInt scaling
    // Aave V3 getUserAccountData() returns healthFactor as uint256 in WAD (1e18)
    const reportedHF = wadToDecimal(raw.healthFactor, 6);

    // CRITICAL: Compute derived HF from position components
    const derivedHF = computeDerivedHealthFactor(
      totalCollateralUSD,
      totalDebtUSD,
      liquidationThreshold
    );

    // CRITICAL: Select the most reliable health factor
    const { healthFactor, usedDerived } = selectHealthFactor(
      reportedHF,
      derivedHF,
      userAddress
    );

    // Log detailed data for debugging
    logger.aave.debug('Fetched user account data', {
      user: userAddress.slice(0, 10) + '...',
      reportedHF: reportedHF.toFixed(6),
      derivedHF: derivedHF.toFixed(6),
      finalHF: healthFactor === Infinity ? '∞' : healthFactor.toFixed(4),
      usedDerived,
      collateralUSD: totalCollateralUSD.toFixed(2),
      debtUSD: totalDebtUSD.toFixed(2),
      lt: liquidationThreshold.toFixed(4),
      rawHealthFactor: raw.healthFactor.toString(),
      baseCurrencyDecimals: AAVE_BASE_CURRENCY.decimals,
    });

    // Additional sanity check: if there's debt but HF comes out as 0 or negative
    if (totalDebtUSD > 0.01 && healthFactor <= 0) {
      logger.aave.error('CRITICAL: Health factor is invalid despite having debt', {
        user: userAddress,
        healthFactor,
        reportedHF,
        derivedHF,
        totalDebtUSD,
        totalCollateralUSD,
        liquidationThreshold,
      });
      // Use derived HF as last resort
      const emergencyHF = derivedHF > 0 ? derivedHF : 0.01;
      logger.aave.warn('Using emergency derived HF', { emergencyHF });
      return {
        healthFactor: emergencyHF,
        totalCollateralUSD,
        totalDebtUSD,
        liquidationThreshold,
      };
    }

    const data: AaveAccountData = {
      healthFactor,
      totalCollateralUSD,
      totalDebtUSD,
      liquidationThreshold,
    };

    return data;
  } catch (error) {
    // Fail safely - return null on any read error
    // Caller should skip this user rather than crash
    logger.aave.error('Failed to fetch user account data', {
      user: userAddress,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Check if user position needs rescue
 * 
 * A rescue is needed when:
 * 1. User has outstanding debt (totalDebtUSD > 0)
 * 2. Health factor is below the trigger threshold (HF < minHF)
 * 
 * @param accountData - User's current Aave position
 * @param minHF - Health factor threshold from ENS policy
 * @returns true if rescue should be triggered
 */
export function needsRescue(accountData: AaveAccountData, minHF: number): boolean {
  // No debt = no liquidation risk, no rescue needed
  if (accountData.totalDebtUSD <= 0) {
    return false;
  }

  // Rescue needed if health factor is below threshold
  return accountData.healthFactor < minHF;
}

/**
 * Get a human-readable risk assessment
 * 
 * Risk levels:
 * - CRITICAL: HF < 1.05 (very close to liquidation)
 * - WARNING: HF < 1.2 (approaching danger)
 * - HEALTHY: HF >= 1.2
 */
export function getRiskLevel(hf: number): 'CRITICAL' | 'WARNING' | 'HEALTHY' {
  if (hf < 1.05) return 'CRITICAL';
  if (hf < 1.2) return 'WARNING';
  return 'HEALTHY';
}
