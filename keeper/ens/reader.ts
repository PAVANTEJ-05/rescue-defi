/**
 * ENS Record Reader for Rescue.ETH
 * 
 * ============================================================
 * DEMO-ONLY / FORK ENVIRONMENT
 * ============================================================
 * 
 * This module reads rescue configuration from ENS text records.
 * It is designed to work on a FORKED MAINNET environment.
 * 
 * WHY FORKS:
 * - ENS is only on mainnet (and testnets)
 * - Testing requires reading/writing ENS records without real costs
 * - Impersonation allows writing records for any ENS name on fork
 * 
 * ENS RECORD KEYS:
 * - rescue.minHF        → Minimum health factor to trigger rescue
 * - rescue.targetHF     → Target health factor after rescue
 * - rescue.maxAmount    → Maximum USD amount per rescue
 * - rescue.cooldown     → Seconds between rescues
 * - rescue.allowedTokens → Comma-separated token symbols
 * - rescue.allowedChains → Comma-separated chain IDs
 * 
 * PRODUCTION NOTES:
 * - Real mainnet RPC would be used (not fork)
 * - No impersonation needed for reads
 * - Users set their own records via ENS app
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
 * Default mainnet fork URL
 * 
 * For demo/testing, this should point to a local Anvil fork.
 * For production, use a real mainnet RPC.
 */
const DEFAULT_MAINNET_RPC = 'https://virtual.rpc.tenderly.co/godofdeath/project/private/etherum-fork1/e0771959-4d8b-4382-9b62-c26eb29cd765';

/**
 * Create a viem public client for ENS reads
 * 
 * @param rpcUrl - RPC URL (defaults to local fork)
 * @returns Configured public client
 */
export function createEnsPublicClient(rpcUrl: string = DEFAULT_MAINNET_RPC): PublicClient {
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
 * @param client - Viem public client (or will create default)
 * @returns Raw config object with string values
 */
export async function readAllEnsConfig(
  ensName: string,
  client?: PublicClient
): Promise<RawEnsConfig> {
  const publicClient = client ?? createEnsPublicClient();
  const config: RawEnsConfig = {};

  // Read all keys in parallel
  const results = await Promise.all(
    ALL_ENS_KEYS.map(async (key) => ({
      key,
      value: await readEnsText(ensName, key, publicClient),
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
 * This is a compatibility wrapper for the keeper which uses ethers.
 * It creates a viem client internally.
 * 
 * @param ensName - The ENS name to read from
 * @param provider - Ethers provider (used to extract RPC URL if possible)
 * @returns Raw config object, or null if no records found
 */
export async function readEnsConfig(
  ensName: string,
  provider: Provider
): Promise<RawEnsConfig | null> {
  // Create a viem client
  // Note: We can't easily extract RPC URL from ethers provider,
  // so we use the default fork URL
  const client = createEnsPublicClient();
  
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
 * @param client - Viem public client
 * @returns True if rescue config exists
 */
export async function hasRescueConfig(
  ensName: string,
  client?: PublicClient
): Promise<boolean> {
  const publicClient = client ?? createEnsPublicClient();
  const minHF = await readEnsText(ensName, ENS_KEYS.MIN_HF, publicClient);
  return minHF !== null;
}

/**
 * Resolve ENS name to address
 * 
 * Utility function to get the wallet address for an ENS name.
 * 
 * @param ensName - The ENS name
 * @param client - Viem public client
 * @returns The resolved address, or null if not found
 */
export async function resolveEnsAddress(
  ensName: string,
  client?: PublicClient
): Promise<`0x${string}` | null> {
  const publicClient = client ?? createEnsPublicClient();
  
  try {
    const address = await publicClient.getEnsAddress({
      name: normalize(ensName),
    });
    return address ?? null;
  } catch (error) {
    console.warn(`Failed to resolve ENS name ${ensName}:`, error);
    return null;
  }
}
