/**
 * Aave V3 Risk Monitoring
 * Read-only module for fetching user health factor and debt data
 */

import type { Provider } from "ethers";
import { getAavePool } from "./pool.js";

/**
 * User risk data returned by the monitor
 */
export interface UserRiskData {
  /** Health factor as a decimal (1.0 = liquidation threshold) */
  healthFactor: number;
  /** Total debt in USD (base currency approximation) */
  totalDebtUsd: number;
}

/**
 * Raw data from Aave getUserAccountData
 */
interface AaveAccountData {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
}

/** Ray scaling factor for Aave (1e27 for some values, 1e18 for health factor) */
const HEALTH_FACTOR_DECIMALS = 18n;
const HEALTH_FACTOR_DIVISOR = 10n ** HEALTH_FACTOR_DECIMALS;

/** Base currency decimals (Aave uses 8 decimals for USD base) */
const BASE_CURRENCY_DECIMALS = 8n;
const BASE_CURRENCY_DIVISOR = 10n ** BASE_CURRENCY_DECIMALS;

/**
 * Fetches user risk data from Aave V3 Pool
 * 
 * @param poolAddress - Aave V3 Pool contract address
 * @param userAddress - Address of the user to monitor
 * @param provider - Ethers provider for read-only calls
 * @returns User risk data or null if the call fails
 */
export async function getUserRisk(
  poolAddress: string,
  userAddress: string,
  provider: Provider
): Promise<UserRiskData | null> {
  try {
    const pool = getAavePool(poolAddress, provider);
    
    const accountData: AaveAccountData = await pool.getUserAccountData(userAddress);
    
    // Convert health factor from ray (1e18) to decimal number
    // Health factor of 1e18 = 1.0 (liquidation threshold)
    const healthFactor = Number(accountData.healthFactor) / Number(HEALTH_FACTOR_DIVISOR);
    
    // Convert total debt from base currency units to USD
    // Aave base currency uses 8 decimals
    const totalDebtUsd = Number(accountData.totalDebtBase) / Number(BASE_CURRENCY_DIVISOR);
    
    return {
      healthFactor,
      totalDebtUsd,
    };
  } catch (error) {
    // Read failure → return null (safety over liveness)
    console.error("[Aave Monitor] Failed to fetch user account data:", error);
    return null;
  }
}
