/**
 * Unit conversion utilities for Rescue.ETH
 * 
 * Handles conversions between different decimal representations
 * used across Aave, ERC20s, and price feeds.
 * 
 * CRITICAL: All BigInt conversions must use safe scaling to avoid precision loss.
 * Never use Number(bigint) directly on large values!
 */

/**
 * Aave uses WAD (1e18) for health factor in getUserAccountData
 * NOTE: Despite Aave docs sometimes mentioning RAY, getUserAccountData
 * actually returns health factor in WAD (1e18) format.
 */
export const WAD_DECIMALS = 18n;
export const WAD = 10n ** WAD_DECIMALS;

/**
 * Aave uses RAY (1e27) for rate calculations (not health factor)
 */
export const RAY_DECIMALS = 27n;
export const RAY = 10n ** RAY_DECIMALS;

/**
 * Aave base currency uses 8 decimals (USD)
 */
export const BASE_CURRENCY_DECIMALS = 8n;
export const BASE_CURRENCY_UNIT = 10n ** BASE_CURRENCY_DECIMALS;

/**
 * Safe conversion precision for RAY to decimal
 * Using 18 decimals of precision for intermediate calculations
 */
const PRECISION_DECIMALS = 18n;
const PRECISION_UNIT = 10n ** PRECISION_DECIMALS;

/**
 * Standard ERC20 decimals
 */
export const COMMON_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  WETH: 18,
  ETH: 18,
};

/**
 * Convert WAD value (1e18) to decimal number
 * 
 * Aave V3 getUserAccountData() returns health factor as uint256 in WAD (1e18).
 * 
 * Example:
 *   WAD = 1e18
 *   healthFactor = 2.6e18 (represents HF of 2.6)
 *   wadToDecimal(2.6e18) => 2.6
 * 
 * @param wad - BigInt value in WAD (1e18) units
 * @param precision - Number of decimal places in result (default: 6)
 * @returns Decimal number representation
 */
export function wadToDecimal(wad: bigint, precision: number = 6): number {
  if (wad === 0n) return 0;
  
  // For very large values (effectively infinity — no debt scenario)
  const MAX_REASONABLE_HF_WAD = 10n ** 27n; // 1e9 as a WAD value
  if (wad >= MAX_REASONABLE_HF_WAD) {
    return Infinity;
  }

  const precisionMultiplier = BigInt(10 ** precision);
  const scaled = (wad * precisionMultiplier) / WAD;
  return Number(scaled) / (10 ** precision);
}

/**
 * Convert RAY value (1e27) to decimal number with specified precision
 * 
 * CRITICAL FIX: This function safely handles large BigInt values from Aave.
 * The health factor from getUserAccountData() is a uint256 in RAY (1e27).
 * 
 * Example:
 *   RAY = 1e27
 *   healthFactor = 1.5e27 (represents HF of 1.5)
 *   rayToDecimal(1.5e27) => 1.5
 * 
 * For very large values (near type(uint256).max), returns Infinity.
 * 
 * @param ray - BigInt value in RAY (1e27) units
 * @param precision - Number of decimal places in result (default: 6)
 * @returns Decimal number representation
 */
export function rayToDecimal(ray: bigint, precision: number = 6): number {
  // Handle edge cases
  if (ray === 0n) return 0;
  
  // For very large values (effectively infinity in Aave's context)
  // type(uint256).max / RAY would still be a huge number
  // Aave uses max uint256 to represent "no debt" scenarios
  const MAX_REASONABLE_HF = 10n ** 36n; // 1e9 as a RAY value
  if (ray >= MAX_REASONABLE_HF) {
    return Infinity;
  }
  
  // Safe conversion using BigInt arithmetic to preserve precision
  // Scale up by precision first, then divide by RAY, then convert
  const precisionMultiplier = BigInt(10 ** precision);
  const scaled = (ray * precisionMultiplier) / RAY;
  
  // Now safe to convert to Number since scaled is much smaller
  // (max precision of 1e6 means result is at most 1e6 * HF)
  return Number(scaled) / (10 ** precision);
}

/**
 * Convert RAY value (1e27) to decimal number
 * 
 * DEPRECATED: Use rayToDecimal() for explicit precision control.
 * This function is kept for backward compatibility.
 * 
 * @param ray - BigInt value in RAY units
 * @returns Decimal number
 */
export function rayToNumber(ray: bigint): number {
  return rayToDecimal(ray, 6);
}

/**
 * Convert base currency value (1e8) to USD number
 */
export function baseCurrencyToUsd(value: bigint): number {
  return Number(value) / Number(BASE_CURRENCY_UNIT);
}

/**
 * Convert USD amount to token units
 * @param usdAmount - Amount in USD
 * @param tokenPrice - Token price in USD
 * @param decimals - Token decimals
 */
export function usdToTokenUnits(
  usdAmount: number,
  tokenPrice: number,
  decimals: number
): bigint {
  const tokenAmount = usdAmount / tokenPrice;
  return BigInt(Math.floor(tokenAmount * 10 ** decimals));
}

/**
 * Convert token units to USD
 * @param tokenUnits - Amount in token smallest units
 * @param tokenPrice - Token price in USD
 * @param decimals - Token decimals
 */
export function tokenUnitsToUsd(
  tokenUnits: bigint,
  tokenPrice: number,
  decimals: number
): number {
  const tokenAmount = Number(tokenUnits) / 10 ** decimals;
  return tokenAmount * tokenPrice;
}

/**
 * Format USD value for display
 */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Format health factor for display
 */
export function formatHealthFactor(hf: number): string {
  if (hf > 100) return '∞';
  return hf.toFixed(4);
}

/**
 * Parse percentage from basis points (1 bp = 0.01%)
 * Aave uses basis points for LTV and liquidation threshold
 */
export function bpsToDecimal(bps: bigint): number {
  return Number(bps) / 10_000;
}
