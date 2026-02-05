/**
 * Aave V3 Position Monitoring
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Reads user position data from Aave V3 Pool contract
 * - Normalizes raw Aave data (RAY, base currency) to human-readable formats
 * - Provides helper functions to assess position risk
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT write to Aave (no supply, no repay)
 * - Does NOT manage approvals
 * - Does NOT fetch token prices (Aave provides USD values)
 * 
 * ============================================================
 * ASSUMPTIONS:
 * ============================================================
 * - Provider is connected to the correct chain
 * - Pool address is a valid Aave V3 Pool
 * - User has an Aave position (may be zero)
 */

import type { Provider } from 'ethers';
import { getAavePool } from './pool.js';
import type { AaveAccountData } from '../config/types.js';
import { rayToNumber, baseCurrencyToUsd, bpsToDecimal } from '../utils/units.js';
import { logger } from '../utils/logger.js';

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
 * Fetch user's Aave position data
 * 
 * Calls Aave Pool.getUserAccountData() and normalizes the response.
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
    
    // Convert from Aave's internal representations:
    // - healthFactor: RAY (1e27) → decimal number
    // - collateral/debt: base currency (1e8) → USD number
    // - liquidationThreshold: basis points → decimal
    const healthFactor = rayToNumber(raw.healthFactor);
    const totalCollateralUSD = baseCurrencyToUsd(raw.totalCollateralBase);
    const totalDebtUSD = baseCurrencyToUsd(raw.totalDebtBase);
    const liquidationThreshold = bpsToDecimal(raw.currentLiquidationThreshold);

    const data: AaveAccountData = {
      healthFactor,
      totalCollateralUSD,
      totalDebtUSD,
      liquidationThreshold,
    };

    logger.aave.debug('Fetched user account data', {
      user: userAddress,
      hf: healthFactor.toFixed(4),
      collateralUSD: totalCollateralUSD.toFixed(2),
      debtUSD: totalDebtUSD.toFixed(2),
      lt: liquidationThreshold.toFixed(4),
    });

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
