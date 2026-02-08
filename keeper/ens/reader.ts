/**
 * ENS Record Reader for Rescue.ETH
 * 
 * ============================================================
 * PRODUCTION MODULE
 * ============================================================
 * 
 * This module reads rescue configuration from ENS text records.
 * ENS is only deployed on Ethereum mainnet, so a mainnet provider
 * is always required regardless of which chain the keeper operates on.
 * 
 * ENS RECORD KEYS:
 * - rescue.enabled       → Must be "true" to allow rescues
 * - rescue.minHF         → Minimum health factor to trigger rescue
 * - rescue.targetHF      → Target health factor after rescue
 * - rescue.maxAmount     → Maximum USD amount per rescue
 * - rescue.cooldown      → Seconds between rescues
 * - rescue.allowedTokens → Comma-separated token symbols
 * - rescue.allowedChains → Comma-separated chain IDs
 * 
 * USAGE:
 * - Users set records via the ENS app (app.ens.domains)
 * - Keeper reads records using a mainnet RPC endpoint
 * - No impersonation needed (reads are public)
 * ============================================================
 */

import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import type { Provider } from 'ethers';

// ============================================================
// ENS RECORD KEYS
// ============================================================

/**
 * ENS text record keys for rescue configuration
 * 
 * These are the standard keys that Rescue.ETH reads from ENS.
 * Users must set these records on their ENS name to configure rescues.
 * 
 * CRITICAL: rescue.enabled MUST be "true" for any rescue to execute.
 */
export const ENS_KEYS = {
  ENABLED: 'rescue.enabled',      // REQUIRED: Must be "true" to enable
  MIN_HF: 'rescue.minHF',
  TARGET_HF: 'rescue.targetHF',
  MAX_AMOUNT: 'rescue.maxAmount',
  COOLDOWN: 'rescue.cooldown',
  ALLOWED_TOKENS: 'rescue.allowedTokens',
  ALLOWED_CHAINS: 'rescue.allowedChains',
} as const;

/**
 * All ENS keys as an array (for iteration)
 */
export const ALL_ENS_KEYS = Object.values(ENS_KEYS);

// ============================================================
// RAW CONFIG TYPE
// ============================================================

/**
 * Raw configuration as read from ENS
 * 
 * All values are strings because ENS text records are strings.
 * See parser.ts for conversion to typed RescuePolicy.
 */
export interface RawEnsConfig {
  [ENS_KEYS.ENABLED]?: string;
  [ENS_KEYS.MIN_HF]?: string;
  [ENS_KEYS.TARGET_HF]?: string;
  [ENS_KEYS.MAX_AMOUNT]?: string;
  [ENS_KEYS.COOLDOWN]?: string;
  [ENS_KEYS.ALLOWED_TOKENS]?: string;
  [ENS_KEYS.ALLOWED_CHAINS]?: string;
}

// ============================================================
// CLIENT CREATION
// ============================================================

/**
 * Create a viem public client for ENS reads
 * 
 * @param rpcUrl - Mainnet RPC URL (required — no default)
 * @returns Configured public client
 */
export function createEnsPublicClient(rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });
}

// ============================================================
// ENS READING FUNCTIONS
// ============================================================

/**
 * Read a single ENS text record
 * 
 * @param ensName - The ENS name (e.g., 'nick.eth')
 * @param key - The text record key (e.g., 'rescue.minHF')
 * @param client - Viem public client
 * @returns The text value, or null if not set
 */
export async function readEnsText(
  ensName: string,
  key: string,
  client: PublicClient
): Promise<string | null> {
  try {
    const value = await client.getEnsText({
      name: normalize(ensName),
      key,
    });
    return value ?? null;
  } catch (error) {
    console.warn(`Failed to read ENS text record ${key} for ${ensName}:`, error);
    return null;
  }
}

/**
 * Read all rescue configuration records from ENS
 * 
 * This reads all the rescue.* text records for a given ENS name.
 * Returns partial config if some records are missing.
 * 
 * @param ensName - The ENS name to read from
 * @param client - Viem public client (required)
 * @returns Raw config object with string values
 */
export async function readAllEnsConfig(
  ensName: string,
  client: PublicClient
): Promise<RawEnsConfig> {
  const config: RawEnsConfig = {};

  // Read all keys in parallel
  const results = await Promise.all(
    ALL_ENS_KEYS.map(async (key) => ({
      key,
      value: await readEnsText(ensName, key, client),
    }))
  );

  // Collect non-null results
  for (const { key, value } of results) {
    if (value !== null) {
      (config as any)[key] = value;
    }
  }

  return config;
}

/**
 * Read ENS config using ethers Provider
 * 
 * Creates a viem client from the provider's connection URL.
 * This bridges the ethers → viem boundary for ENS reads.
 * 
 * CRITICAL: The provider MUST be a mainnet provider (chainId 1).
 * ENS is only deployed on mainnet.
 * 
 * @param ensName - The ENS name to read from
 * @param provider - Ethers mainnet provider
 * @returns Raw config object, or null if no records found
 */
export async function readEnsConfig(
  ensName: string,
  provider: Provider
): Promise<RawEnsConfig | null> {
  // Extract RPC URL from ethers JsonRpcProvider
  // ethers v6: (provider as any)._getConnection?.().url or provider.provider?._getConnection?.().url
  let rpcUrl: string | undefined;
  try {
    // ethers v6 JsonRpcProvider stores URL in internal _getConnection
    const providerAny = provider as any;
    if (providerAny._getConnection) {
      rpcUrl = providerAny._getConnection().url;
    } else if (providerAny.provider?._getConnection) {
      rpcUrl = providerAny.provider._getConnection().url;
    }
  } catch {
    // Fallback: cannot extract URL
  }

  if (!rpcUrl) {
    // Fallback to a public mainnet RPC if we can't extract the URL
    // This is a safety net — the caller SHOULD be providing a proper mainnet provider
    console.warn('ENS reader: Could not extract RPC URL from provider, falling back to public endpoint');
    rpcUrl = 'https://eth.llamarpc.com';
  }

  const client = createEnsPublicClient(rpcUrl);
  
  const config = await readAllEnsConfig(ensName, client);
  
  // Return null if no records found
  if (Object.keys(config).length === 0) {
    return null;
  }
  
  return config;
}

/**
 * Check if an ENS name has rescue configuration
 * 
 * Quick check to see if at least minHF is set.
 * 
 * @param ensName - The ENS name to check
 * @param client - Viem public client (required)
 * @returns True if rescue config exists
 */
export async function hasRescueConfig(
  ensName: string,
  client: PublicClient
): Promise<boolean> {
  const minHF = await readEnsText(ensName, ENS_KEYS.MIN_HF, client);
  return minHF !== null;
}

/**
 * Resolve ENS name to address
 * 
 * Utility function to get the wallet address for an ENS name.
 * 
 * @param ensName - The ENS name
 * @param client - Viem public client (required)
 * @returns The resolved address, or null if not found
 */
export async function resolveEnsAddress(
  ensName: string,
  client: PublicClient
): Promise<`0x${string}` | null> {
  try {
    const address = await client.getEnsAddress({
      name: normalize(ensName),
    });
    return address ?? null;
  } catch (error) {
    console.warn(`Failed to resolve ENS name ${ensName}:`, error);
    return null;
  }
}
