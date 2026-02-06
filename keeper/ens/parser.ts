/**
 * ENS Config Parser for Rescue.ETH
 * 
 * ============================================================
 * PARSING AND VALIDATION
 * ============================================================
 * 
 * This module converts raw ENS text records (strings) into typed
 * RescuePolicy objects with validation.
 * 
 * VALIDATION RULES:
 * - minHF must be between 1.0 and 2.0
 * - targetHF must be between 1.1 and 3.0
 * - targetHF must be > minHF
 * - maxAmountUSD must be between 1 and 100,000
 * - cooldownSeconds must be between 60 and 604800 (7 days)
 * 
 * DEFAULTS:
 * - Used when ENS records are missing (demo mode)
 * - Conservative values for safety
 * - See config/defaults.ts for values
 * 
 * ============================================================
 */

import type { RescuePolicy } from '../config/types.js';
import { DEFAULT_POLICY, POLICY_BOUNDS } from '../config/defaults.js';
import { ENS_KEYS, type RawEnsConfig } from './reader.js';

// ============================================================
// PARSING FUNCTIONS
// ============================================================

/**
 * Parse a numeric string with validation
 * 
 * @param value - String value from ENS
 * @param fallback - Default value if parsing fails
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Parsed and bounded number
 */
function parseNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    console.warn(`Invalid number value: ${value}, using fallback: ${fallback}`);
    return fallback;
  }

  // Clamp to bounds
  if (parsed < min) {
    console.warn(`Value ${parsed} below minimum ${min}, clamping`);
    return min;
  }
  if (parsed > max) {
    console.warn(`Value ${parsed} above maximum ${max}, clamping`);
    return max;
  }

  return parsed;
}

/**
 * Parse a comma-separated string into array of strings
 * 
 * @param value - Comma-separated string (e.g., "USDC,ETH,DAI")
 * @param fallback - Default array if parsing fails
 * @returns Array of trimmed strings
 */
function parseStringArray(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value === '') {
    return fallback;
  }

  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse a comma-separated string into array of numbers
 * 
 * @param value - Comma-separated string (e.g., "1,10,8453")
 * @param fallback - Default array if parsing fails
 * @returns Array of parsed numbers
 */
function parseNumberArray(value: string | undefined, fallback: number[]): number[] {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));

  return parsed.length > 0 ? parsed : fallback;
}

// ============================================================
// MAIN PARSER
// ============================================================

/**
 * Parse raw ENS config into typed RescuePolicy
 * 
 * This is the main parsing function. It:
 * 1. Extracts each field from raw config
 * 2. Validates and bounds numeric values
 * 3. Falls back to defaults for missing fields
 * 4. Ensures policy is internally consistent
 * 
 * @param raw - Raw config from ENS (may be partial)
 * @param useFallbacks - If true, use defaults for missing values (demo mode)
 * @returns Parsed policy, or null if invalid and useFallbacks is false
 */
export function parseEnsConfig(
  raw: RawEnsConfig | null,
  useFallbacks: boolean = true
): RescuePolicy | null {
  // If no config and not using fallbacks, return null
  if (!raw && !useFallbacks) {
    return null;
  }

  // Use empty object if null
  const config = raw ?? {};

  // Parse each field
  const minHF = parseNumber(
    config[ENS_KEYS.MIN_HF],
    DEFAULT_POLICY.minHF,
    POLICY_BOUNDS.minHF.min,
    POLICY_BOUNDS.minHF.max
  );

  const targetHF = parseNumber(
    config[ENS_KEYS.TARGET_HF],
    DEFAULT_POLICY.targetHF,
    POLICY_BOUNDS.targetHF.min,
    POLICY_BOUNDS.targetHF.max
  );

  const maxAmountUSD = parseNumber(
    config[ENS_KEYS.MAX_AMOUNT],
    DEFAULT_POLICY.maxAmountUSD,
    POLICY_BOUNDS.maxAmountUSD.min,
    POLICY_BOUNDS.maxAmountUSD.max
  );

  const cooldownSeconds = parseNumber(
    config[ENS_KEYS.COOLDOWN],
    DEFAULT_POLICY.cooldownSeconds,
    POLICY_BOUNDS.cooldownSeconds.min,
    POLICY_BOUNDS.cooldownSeconds.max
  );

  const allowedTokens = parseStringArray(
    config[ENS_KEYS.ALLOWED_TOKENS],
    DEFAULT_POLICY.allowedTokens
  );

  const allowedChains = parseNumberArray(
    config[ENS_KEYS.ALLOWED_CHAINS],
    DEFAULT_POLICY.allowedChains
  );

  // Validation: targetHF must be > minHF
  if (targetHF <= minHF) {
    console.warn(`targetHF (${targetHF}) must be > minHF (${minHF}), adjusting`);
    // Adjust targetHF to be at least minHF + 0.1
    const adjustedTargetHF = Math.min(minHF + 0.3, POLICY_BOUNDS.targetHF.max);
    return {
      minHF,
      targetHF: adjustedTargetHF,
      maxAmountUSD,
      cooldownSeconds,
      allowedTokens,
      allowedChains,
    };
  }

  return {
    minHF,
    targetHF,
    maxAmountUSD,
    cooldownSeconds,
    allowedTokens,
    allowedChains,
  };
}

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Check if a chain ID is allowed by the policy
 * 
 * @param chainId - Chain ID to check
 * @param policy - Rescue policy
 * @returns True if chain is in allowedChains
 */
export function isChainAllowed(chainId: number, policy: RescuePolicy): boolean {
  return policy.allowedChains.includes(chainId);
}

/**
 * Check if a token symbol is allowed by the policy
 * 
 * @param symbol - Token symbol to check (e.g., "USDC")
 * @param policy - Rescue policy
 * @returns True if token is in allowedTokens
 */
export function isTokenAllowed(symbol: string, policy: RescuePolicy): boolean {
  return policy.allowedTokens
    .map((t) => t.toUpperCase())
    .includes(symbol.toUpperCase());
}

/**
 * Validate a complete policy object
 * 
 * Checks all invariants and bounds.
 * 
 * @param policy - Policy to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validatePolicy(policy: RescuePolicy): string[] {
  const errors: string[] = [];

  // Check bounds
  if (policy.minHF < POLICY_BOUNDS.minHF.min || policy.minHF > POLICY_BOUNDS.minHF.max) {
    errors.push(`minHF ${policy.minHF} out of bounds [${POLICY_BOUNDS.minHF.min}, ${POLICY_BOUNDS.minHF.max}]`);
  }

  if (policy.targetHF < POLICY_BOUNDS.targetHF.min || policy.targetHF > POLICY_BOUNDS.targetHF.max) {
    errors.push(`targetHF ${policy.targetHF} out of bounds [${POLICY_BOUNDS.targetHF.min}, ${POLICY_BOUNDS.targetHF.max}]`);
  }

  if (policy.maxAmountUSD < POLICY_BOUNDS.maxAmountUSD.min || policy.maxAmountUSD > POLICY_BOUNDS.maxAmountUSD.max) {
    errors.push(`maxAmountUSD ${policy.maxAmountUSD} out of bounds [${POLICY_BOUNDS.maxAmountUSD.min}, ${POLICY_BOUNDS.maxAmountUSD.max}]`);
  }

  if (policy.cooldownSeconds < POLICY_BOUNDS.cooldownSeconds.min || policy.cooldownSeconds > POLICY_BOUNDS.cooldownSeconds.max) {
    errors.push(`cooldownSeconds ${policy.cooldownSeconds} out of bounds [${POLICY_BOUNDS.cooldownSeconds.min}, ${POLICY_BOUNDS.cooldownSeconds.max}]`);
  }

  // Check invariants
  if (policy.targetHF <= policy.minHF) {
    errors.push(`targetHF (${policy.targetHF}) must be greater than minHF (${policy.minHF})`);
  }

  if (policy.allowedTokens.length === 0) {
    errors.push('allowedTokens cannot be empty');
  }

  if (policy.allowedChains.length === 0) {
    errors.push('allowedChains cannot be empty');
  }

  return errors;
}

/**
 * Format policy for display/logging
 * 
 * @param policy - Policy to format
 * @returns Human-readable string
 */
export function formatPolicy(policy: RescuePolicy): string {
  return [
    `Rescue Policy:`,
    `  Min HF: ${policy.minHF}`,
    `  Target HF: ${policy.targetHF}`,
    `  Max Amount: $${policy.maxAmountUSD}`,
    `  Cooldown: ${policy.cooldownSeconds}s`,
    `  Allowed Tokens: ${policy.allowedTokens.join(', ')}`,
    `  Allowed Chains: ${policy.allowedChains.join(', ')}`,
  ].join('\n');
}
