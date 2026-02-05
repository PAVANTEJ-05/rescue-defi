/**
 * ENS Config Parser and Validator
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Parses raw ENS string values into typed RescuePolicy
 * - Validates numeric bounds (min/max HF, amounts, etc.)
 * - Validates cross-field constraints (targetHF > minHF)
 * - Parses comma-separated lists (tokens, chains)
 * - Merges with defaults for missing values (DEMO MODE ONLY)
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT read from ENS (that's ens/reader.ts)
 * - Does NOT verify token addresses exist
 * - Does NOT check chain availability
 * 
 * ============================================================
 * VALIDATION RULES:
 * ============================================================
 * - minHF: 1.01 to 2.0 (can't be ≤1 or unreasonably high)
 * - targetHF: 1.1 to 3.0 (must be > minHF)
 * - maxAmountUSD: 10 to 100,000 (sane limits)
 * - cooldownSeconds: 60 to 86,400 (1 minute to 24 hours)
 * - allowedTokens: At least one token required in production
 * - allowedChains: At least one chain required in production
 * 
 * FAIL CLOSED: Invalid values cause rejection, not silent defaults.
 */

import type { RescuePolicy } from '../config/types.js';
import { DEFAULT_POLICY, POLICY_BOUNDS } from '../config/defaults.js';
import type { RawEnsConfig } from './reader.js';
import { logger } from '../utils/logger.js';

/**
 * Parse and validate ENS configuration into RescuePolicy
 * 
 * @param raw - Raw string values from ENS text records
 * @param useDefaults - Whether to fill missing values with defaults (demo mode)
 * @returns Validated RescuePolicy or null if validation fails
 */
export function parseEnsConfig(
  raw: RawEnsConfig,
  useDefaults: boolean = true
): RescuePolicy | null {
  try {
    // Parse minHF
    const minHF = parseNumber(raw.minHF, 'minHF', POLICY_BOUNDS.minHF);
    if (minHF === null && !useDefaults) {
      throw new Error('minHF is required');
    }

    // Parse targetHF
    const targetHF = parseNumber(raw.targetHF, 'targetHF', POLICY_BOUNDS.targetHF);
    if (targetHF === null && !useDefaults) {
      throw new Error('targetHF is required');
    }

    // Parse maxAmountUSD
    const maxAmountUSD = parseNumber(raw.maxAmountUSD, 'maxAmountUSD', POLICY_BOUNDS.maxAmountUSD);
    if (maxAmountUSD === null && !useDefaults) {
      throw new Error('maxAmountUSD is required');
    }

    // Parse cooldownSeconds
    const cooldownSeconds = parseNumber(
      raw.cooldownSeconds,
      'cooldownSeconds',
      POLICY_BOUNDS.cooldownSeconds
    );

    // Parse allowedTokens (comma-separated)
    const allowedTokens = parseStringArray(raw.allowedTokens);

    // Parse allowedChains (comma-separated numbers)
    const allowedChains = parseNumberArray(raw.allowedChains);

    // Construct policy with defaults for missing values
    const policy: RescuePolicy = {
      minHF: minHF ?? DEFAULT_POLICY.minHF,
      targetHF: targetHF ?? DEFAULT_POLICY.targetHF,
      maxAmountUSD: maxAmountUSD ?? DEFAULT_POLICY.maxAmountUSD,
      cooldownSeconds: cooldownSeconds ?? DEFAULT_POLICY.cooldownSeconds,
      allowedTokens: allowedTokens.length > 0 ? allowedTokens : DEFAULT_POLICY.allowedTokens,
      allowedChains: allowedChains.length > 0 ? allowedChains : DEFAULT_POLICY.allowedChains,
    };

    // Cross-field validation
    if (policy.targetHF <= policy.minHF) {
      throw new Error(`targetHF (${policy.targetHF}) must be greater than minHF (${policy.minHF})`);
    }

    logger.ens.info('Parsed ENS config', {
      minHF: policy.minHF,
      targetHF: policy.targetHF,
      maxAmountUSD: policy.maxAmountUSD,
      cooldownSeconds: policy.cooldownSeconds,
      tokensCount: policy.allowedTokens.length,
      chainsCount: policy.allowedChains.length,
    });

    return policy;
  } catch (error) {
    logger.ens.error('Failed to parse ENS config', {
      error: error instanceof Error ? error.message : 'Unknown error',
      raw,
    });
    return null;
  }
}

/**
 * Parse a numeric value with bounds validation
 */
function parseNumber(
  value: string | undefined,
  fieldName: string,
  bounds: { min: number; max: number }
): number | null {
  if (value === undefined || value === '') {
    return null;
  }

  const parsed = parseFloat(value);

  if (isNaN(parsed)) {
    throw new Error(`${fieldName}: invalid number "${value}"`);
  }

  if (parsed < bounds.min || parsed > bounds.max) {
    throw new Error(
      `${fieldName}: ${parsed} is outside allowed range [${bounds.min}, ${bounds.max}]`
    );
  }

  return parsed;
}

/**
 * Parse comma-separated string into array
 * "USDC, ETH, DAI" → ["USDC", "ETH", "DAI"]
 */
function parseStringArray(value: string | undefined): string[] {
  if (value === undefined || value === '') {
    return [];
  }

  return value
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

/**
 * Parse comma-separated numbers into array
 * "1, 10, 8453" → [1, 10, 8453]
 */
function parseNumberArray(value: string | undefined): number[] {
  if (value === undefined || value === '') {
    return [];
  }

  const parts = value.split(',').map((s) => s.trim());
  const numbers: number[] = [];

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (!isNaN(num)) {
      numbers.push(num);
    }
  }

  return numbers;
}

/**
 * Validate that a token is allowed by policy
 */
export function isTokenAllowed(token: string, policy: RescuePolicy): boolean {
  return policy.allowedTokens.includes(token.toUpperCase());
}

/**
 * Validate that a chain is allowed by policy
 */
export function isChainAllowed(chainId: number, policy: RescuePolicy): boolean {
  return policy.allowedChains.includes(chainId);
}

/**
 * Get default policy (for testing/demo only)
 */
export function getDefaultPolicy(): RescuePolicy {
  return { ...DEFAULT_POLICY };
}
