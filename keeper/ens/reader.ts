/**
 * ENS Text Record Reader
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Reads raw ENS text records from mainnet
 * - Looks up resolver address for ENS name
 * - Fetches all rescue.* text records
 * - Returns raw strings (no parsing/validation)
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT parse or validate values (that's ens/parser.ts)
 * - Does NOT write to ENS
 * - Does NOT cache results
 * 
 * ============================================================
 * ENS KEYS USED:
 * ============================================================
 * - rescue.minHF: Trigger threshold (e.g., "1.3")
 * - rescue.targetHF: Goal after rescue (e.g., "1.8")
 * - rescue.maxAmountUSD: Max single rescue (e.g., "5000")
 * - rescue.allowedTokens: Comma-separated symbols (e.g., "USDC,USDT,DAI")
 * - rescue.allowedChains: Comma-separated chain IDs (e.g., "1,42161,10")
 * - rescue.cooldownSeconds: Min time between rescues (e.g., "3600")
 * 
 * ENS is the SINGLE SOURCE OF TRUTH for user policy configuration.
 */

import { type Provider, namehash } from 'ethers';
import { Contract } from 'ethers';
import { logger } from '../utils/logger.js';

/**
 * ENS Registry address (same on mainnet and most networks)
 */
const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

/**
 * ENS Public Resolver ABI (text record function only)
 */
const RESOLVER_ABI = [
  {
    inputs: [
      { internalType: 'bytes32', name: 'node', type: 'bytes32' },
      { internalType: 'string', name: 'key', type: 'string' },
    ],
    name: 'text',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
];

/**
 * ENS Registry ABI (resolver lookup only)
 */
const REGISTRY_ABI = [
  {
    inputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }],
    name: 'resolver',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

/**
 * Rescue.ETH ENS text record keys
 */
export const ENS_KEYS = {
  MIN_HF: 'rescue.minHF',
  TARGET_HF: 'rescue.targetHF',
  MAX_AMOUNT_USD: 'rescue.maxAmountUSD',
  ALLOWED_TOKENS: 'rescue.allowedTokens',
  ALLOWED_CHAINS: 'rescue.allowedChains',
  COOLDOWN_SECONDS: 'rescue.cooldownSeconds',
} as const;

/**
 * Raw ENS text records (unparsed strings)
 */
export interface RawEnsConfig {
  minHF?: string | undefined;
  targetHF?: string | undefined;
  maxAmountUSD?: string | undefined;
  allowedTokens?: string | undefined;
  allowedChains?: string | undefined;
  cooldownSeconds?: string | undefined;
}

/**
 * Get the resolver address for an ENS name
 */
async function getResolver(
  ensName: string,
  provider: Provider
): Promise<string | null> {
  try {
    const registry = new Contract(ENS_REGISTRY_ADDRESS, REGISTRY_ABI, provider);
    const node = namehash(ensName);
    const resolverAddress: string = await (registry.resolver as (node: string) => Promise<string>)(node);

    if (resolverAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    return resolverAddress;
  } catch (error) {
    logger.ens.error('Failed to get resolver', {
      ensName,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Read a single ENS text record
 */
async function readTextRecord(
  ensName: string,
  key: string,
  resolverAddress: string,
  provider: Provider
): Promise<string | undefined> {
  try {
    const resolver = new Contract(resolverAddress, RESOLVER_ABI, provider);
    const node = namehash(ensName);
    const value: string = await (resolver.text as (node: string, key: string) => Promise<string>)(node, key);

    // Empty string means no record set
    return value || undefined;
  } catch (error) {
    logger.ens.debug('Failed to read text record', { ensName, key });
    return undefined;
  }
}

/**
 * Fetch all Rescue.ETH configuration from ENS text records
 * 
 * @param ensName - ENS name to query (e.g., "vitalik.eth")
 * @param provider - Ethers provider (should be mainnet for ENS)
 * @returns Raw string values for each config key, or null if resolver not found
 */
export async function readEnsConfig(
  ensName: string,
  provider: Provider
): Promise<RawEnsConfig | null> {
  logger.ens.info('Reading ENS config', { ensName });

  // Step 1: Get resolver for this name
  const resolverAddress = await getResolver(ensName, provider);
  if (!resolverAddress) {
    logger.ens.warn('No resolver found for ENS name', { ensName });
    return null;
  }

  // Step 2: Read all text records in parallel
  const [minHF, targetHF, maxAmountUSD, allowedTokens, allowedChains, cooldownSeconds] =
    await Promise.all([
      readTextRecord(ensName, ENS_KEYS.MIN_HF, resolverAddress, provider),
      readTextRecord(ensName, ENS_KEYS.TARGET_HF, resolverAddress, provider),
      readTextRecord(ensName, ENS_KEYS.MAX_AMOUNT_USD, resolverAddress, provider),
      readTextRecord(ensName, ENS_KEYS.ALLOWED_TOKENS, resolverAddress, provider),
      readTextRecord(ensName, ENS_KEYS.ALLOWED_CHAINS, resolverAddress, provider),
      readTextRecord(ensName, ENS_KEYS.COOLDOWN_SECONDS, resolverAddress, provider),
    ]);

  const config: RawEnsConfig = {
    minHF,
    targetHF,
    maxAmountUSD,
    allowedTokens,
    allowedChains,
    cooldownSeconds,
  };

  logger.ens.debug('Read raw ENS config', { ensName, config });

  return config;
}

/**
 * Check if an ENS name has any Rescue.ETH configuration
 */
export async function hasRescueConfig(
  ensName: string,
  provider: Provider
): Promise<boolean> {
  const config = await readEnsConfig(ensName, provider);
  if (!config) return false;

  // Consider configured if at least minHF or targetHF is set
  return config.minHF !== undefined || config.targetHF !== undefined;
}
