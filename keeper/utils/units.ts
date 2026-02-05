/**
 * Unit conversion utilities for Rescue.ETH
 * 
 * Handles conversions between different decimal representations
 * used across Aave, ERC20s, and price feeds.
 */

/**
 * Aave uses RAY (1e27) for health factor and rate calculations
 */
export const RAY_DECIMALS = 27n;
export const RAY = 10n ** RAY_DECIMALS;

/**
 * Aave base currency uses 8 decimals (USD)
 */
export const BASE_CURRENCY_DECIMALS = 8n;
export const BASE_CURRENCY_UNIT = 10n ** BASE_CURRENCY_DECIMALS;

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
 * Convert RAY value (1e27) to decimal number
 * Used for health factor conversion
 */
export function rayToNumber(ray: bigint): number {
  // Use high precision division
  const scaled = (ray * 1_000_000n) / RAY;
  return Number(scaled) / 1_000_000;
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
