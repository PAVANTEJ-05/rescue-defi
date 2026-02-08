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
 * PRODUCTION SAFETY:
 * - rescue.enabled MUST be "true" for rescues to execute
 * - Only stablecoins are allowed (no price oracle required)
 * - Capped rescues that don't restore HF are REJECTED upstream
 * 
 * VALIDATION RULES:
 * - enabled must be explicitly "true"
 * - minHF must be between 1.0 and 2.0
 * - targetHF must be between 1.1 and 3.0
 * - targetHF must be > minHF
 * - maxAmountUSD must be between 1 and 100,000
 * - cooldownSeconds must be between 60 and 604800 (7 days)
 * - allowedTokens must only contain stablecoins
 * 
 * ============================================================
 * DEFAULT_POLICY FALLBACK BEHAVIOR:
 * ============================================================
 * 
 * CRITICAL: This module ALWAYS falls back to DEFAULT_POLICY when ENS
 * config is missing, unreadable, or empty.
 * 
 * Rules:
 * - If ENS config exists → use ENS values (after bounds validation)
 * - If ENS config does NOT exist → use DEFAULT_POLICY
 * - enabled field must ALWAYS be explicitly checked by caller
 * - If enabled === false → skip rescue (even with valid config)
 * - If enabled === true → rescue allowed (if other conditions met)
 * 
 * The DEFAULT_POLICY is imported from config/defaults.ts:
 * - enabled: false (MUST be explicitly enabled via ENS)
 * - minHF: 1.2
 * - targetHF: 1.5
 * - maxAmountUSD: 10000
 * - cooldownSeconds: 3600
 * - allowedTokens: ['USDC', 'USDT', 'DAI']
 * - allowedChains: [1, 10, 8453]
 * 
 * ============================================================
 */

import type { RescuePolicy } from '../config/types.js';
import { DEFAULT_POLICY, POLICY_BOUNDS, isStablecoin } from '../config/defaults.js';
import { ENS_KEYS, type RawEnsConfig } from './reader.js';
import { logger } from '../utils/logger.js';

// ============================================================
// PARSING FUNCTIONS
// ============================================================

/**
 * Parse a boolean string with strict validation
 * 
 * @param value - String value from ENS
 * @param fallback - Default value if parsing fails
 * @returns Parsed boolean (only "true" = true)
 */
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }
  // Only exact match "true" enables rescue
  return value.toLowerCase() === 'true';
}

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
    logger.ens.warn(`Invalid number value: ${value}, using fallback: ${fallback}`);
    return fallback;
  }

  // Clamp to bounds
  if (parsed < min) {
    logger.ens.warn(`Value ${parsed} below minimum ${min}, clamping`);
    return min;
  }
  if (parsed > max) {
    logger.ens.warn(`Value ${parsed} above maximum ${max}, clamping`);
    return max;
  }

  return parsed;
}

/**
 * Parse a comma-separated string into array of strings
 * 
 * @param value - Comma-separated string (e.g., "USDC,USDT,DAI")
 * @param fallback - Default array if parsing fails
 * @returns Array of trimmed strings
 */
function parseStringArray(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value === '') {
    return fallback;
  }

  return value
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

/**
 * Filter tokens to only include supported stablecoins
 * 
 * CRITICAL: Non-stablecoins are rejected because we assume price = $1
 * 
 * @param tokens - Array of token symbols
 * @returns Array of valid stablecoin symbols
 */
function filterStablecoinsOnly(tokens: string[]): string[] {
  const stablecoins: string[] = [];
  const rejected: string[] = [];

  for (const token of tokens) {
    if (isStablecoin(token)) {
      stablecoins.push(token);
    } else {
      rejected.push(token);
    }
  }

  if (rejected.length > 0) {
    logger.ens.warn('Non-stablecoin tokens rejected from policy', {
      rejected,
      reason: 'Price assumption ($1) only valid for stablecoins',
    });
  }

  return stablecoins;
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
 * Check if rescue force-enable override is active via environment variable
 * 
 * SECURITY WARNING: This override should ONLY be used for:
 * - Controlled testing environments
 * - Emergency operations with explicit user consent
 * 
 * NEVER use in production without proper authorization.
 * 
 * @returns true if RESCUE_FORCE_ENABLE=true in environment
 */
export function isForceEnableOverrideActive(): boolean {
  return process.env['RESCUE_FORCE_ENABLE'] === 'true';
}

/**
 * Log security warning when force-enable override is used
 */
function logForceEnableWarning(): void {
  logger.ens.warn('='.repeat(70));
  logger.ens.warn('[SECURITY] Rescue force-enabled via environment override');
  logger.ens.warn('[SECURITY] RESCUE_FORCE_ENABLE=true detected');
  logger.ens.warn('[SECURITY] This should NEVER be used in production without user consent');
  logger.ens.warn('='.repeat(70));
}

/**
 * Determine effective enabled status considering all sources
 * 
 * Priority order:
 * 1. ENS config present → ENS rescue.enabled controls enablement
 * 2. ENS missing + RESCUE_FORCE_ENABLE=true → enabled with loud warning
 * 3. ENS missing + no override → disabled (DEFAULT_POLICY.enabled = false)
 * 
 * @param ensEnabled - The enabled value from ENS (or default if ENS missing)
 * @param hasEnsConfig - Whether ENS config was actually found
 * @returns The effective enabled status
 */
function resolveEnabledStatus(ensEnabled: boolean, hasEnsConfig: boolean): boolean {
  // If ENS config exists, it is authoritative
  if (hasEnsConfig) {
    return ensEnabled;
  }

  // ENS missing - check for force-enable override
  if (isForceEnableOverrideActive()) {
    logForceEnableWarning();
    return true;
  }

  // No override - use default (false)
  return DEFAULT_POLICY.enabled;
}

/**
 * Parse raw ENS config into typed RescuePolicy
 * 
 * This is the main parsing function. It:
 * 1. Extracts each field from raw config
 * 2. Validates and bounds numeric values
 * 3. ALWAYS falls back to DEFAULT_POLICY for missing fields
 * 4. Ensures policy is internally consistent
 * 5. Filters tokens to stablecoins only
 * 
 * CRITICAL ENABLEMENT BEHAVIOR:
 * - If ENS config exists → ENS rescue.enabled controls enablement
 * - If ENS missing + RESCUE_FORCE_ENABLE=true → rescue enabled with warning
 * - If ENS missing + no override → rescue disabled (safe default)
 * 
 * The caller MUST check policy.enabled before executing any rescue.
 * 
 * @param raw - Raw config from ENS (may be null or partial)
 * @param _useFallbacks - DEPRECATED: Always uses fallbacks per requirements
 * @returns Parsed policy (never null - always falls back to DEFAULT_POLICY)
 */
export function parseEnsConfig(
  raw: RawEnsConfig | null,
  _useFallbacks: boolean = false
): RescuePolicy {
  // ALWAYS use DEFAULT_POLICY as fallback base
  // This ensures the keeper never blocks on missing ENS config
  
  // Log whether we're using ENS values or pure defaults
  const hasAnyConfig = raw && Object.keys(raw).length > 0;
  
  if (!hasAnyConfig) {
    // Check if force-enable override is active
    const forceEnabled = isForceEnableOverrideActive();
    
    if (forceEnabled) {
      logForceEnableWarning();
      logger.ens.info('Using DEFAULT_POLICY with force-enabled override', {
        enabled: true,
        minHF: DEFAULT_POLICY.minHF,
        targetHF: DEFAULT_POLICY.targetHF,
        maxAmountUSD: DEFAULT_POLICY.maxAmountUSD,
        source: 'RESCUE_FORCE_ENABLE environment variable',
      });
      // Return DEFAULT_POLICY with enabled=true
      return { ...DEFAULT_POLICY, enabled: true };
    }

    logger.ens.info('No ENS config found, using DEFAULT_POLICY', {
      enabled: DEFAULT_POLICY.enabled,
      minHF: DEFAULT_POLICY.minHF,
      targetHF: DEFAULT_POLICY.targetHF,
      maxAmountUSD: DEFAULT_POLICY.maxAmountUSD,
      note: 'Rescue will be skipped unless enabled=true is set via ENS or RESCUE_FORCE_ENABLE=true',
    });
    // Return a copy of DEFAULT_POLICY to prevent mutation
    return { ...DEFAULT_POLICY };
  }

  // Use empty object if null for cleaner code
  const config = raw ?? {};

  // Parse enabled flag - CRITICAL: defaults to DEFAULT_POLICY.enabled (false)
  const enabled = parseBoolean(
    config[ENS_KEYS.ENABLED],
    DEFAULT_POLICY.enabled
  );

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

  // Parse and FILTER tokens to stablecoins only
  const rawTokens = parseStringArray(
    config[ENS_KEYS.ALLOWED_TOKENS],
    DEFAULT_POLICY.allowedTokens
  );
  const allowedTokens = filterStablecoinsOnly(rawTokens);

  // If no valid stablecoins remain, use default stablecoins
  if (allowedTokens.length === 0) {
    logger.ens.warn('No valid stablecoins in policy, using defaults', {
      requested: rawTokens,
      defaults: DEFAULT_POLICY.allowedTokens,
    });
    allowedTokens.push(...DEFAULT_POLICY.allowedTokens);
  }

  const allowedChains = parseNumberArray(
    config[ENS_KEYS.ALLOWED_CHAINS],
    DEFAULT_POLICY.allowedChains
  );

  // Validation: targetHF must be > minHF
  let finalTargetHF = targetHF;
  if (targetHF <= minHF) {
    logger.ens.warn(`targetHF (${targetHF}) must be > minHF (${minHF}), adjusting`);
    // Adjust targetHF to be at least minHF + 0.3
    finalTargetHF = Math.min(minHF + 0.3, POLICY_BOUNDS.targetHF.max);
  }

  return {
    enabled,
    minHF,
    targetHF: finalTargetHF,
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

  // Check enabled flag
  if (!policy.enabled) {
    errors.push('Rescue is not enabled (rescue.enabled must be "true")');
  }

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

  // Validate all tokens are stablecoins
  const nonStablecoins = policy.allowedTokens.filter(t => !isStablecoin(t));
  if (nonStablecoins.length > 0) {
    errors.push(`Non-stablecoin tokens not allowed: ${nonStablecoins.join(', ')}`);
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
    `  Enabled: ${policy.enabled}`,
    `  Min HF: ${policy.minHF}`,
    `  Target HF: ${policy.targetHF}`,
    `  Max Amount: $${policy.maxAmountUSD}`,
    `  Cooldown: ${policy.cooldownSeconds}s`,
    `  Allowed Tokens: ${policy.allowedTokens.join(', ')}`,
    `  Allowed Chains: ${policy.allowedChains.join(', ')}`,
  ].join('\n');
}
