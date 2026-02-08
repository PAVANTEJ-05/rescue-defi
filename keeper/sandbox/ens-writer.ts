/**
 * ENS Record Writer for Rescue.ETH
 * 
 * ============================================================
 * DEMO-ONLY / FORK ENVIRONMENT
 * ============================================================
 * 
 * This module writes rescue configuration to ENS text records.
 * It is designed for DEMO AND TESTING on a forked mainnet.
 * 
 * WHY IMPERSONATION:
 * - On a real network, only the ENS name owner can set records
 * - On a fork, we can impersonate ANY address
 * - This allows testing without owning the ENS name
 * 
 * PRODUCTION USAGE:
 * - Users would set records via the ENS app (app.ens.domains)
 * - Or via their own wallet using setRecords
 * - No impersonation needed (user is the owner)
 * 
 * ============================================================
 * ORIGINAL CODE LOCATION: keeper/ens/index.ts
 * This is the restructured write logic from the original file.
 * Core ENS write flow is UNCHANGED.
 * ============================================================
 */

import { addEnsContracts } from '@ensdomains/ensjs';
import { setRecords } from '@ensdomains/ensjs/wallet';
import {
  createWalletClient,
  createTestClient,
  createPublicClient,
  http,
  publicActions,
  walletActions,
} from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import type { RescuePolicy } from '../config/types.js';
import { ENS_KEYS } from '../ens/reader.js';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Default mainnet fork URL
 */
const DEFAULT_MAINNET_RPC = 'https://virtual.rpc.tenderly.co/godofdeath/project/private/etherum-fork1/e0771959-4d8b-4382-9b62-c26eb29cd765';

/**
 * Public ENS resolver address (mainnet)
 * 
 * This is the standard public resolver used by most ENS names.
 * Some names may use custom resolvers.
 */
const PUBLIC_RESOLVER: `0x${string}` = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';

// ============================================================
// CLIENT CREATION
// ============================================================

/**
 * Create clients for ENS operations on fork
 * 
 * Returns both public and test clients needed for impersonation.
 * 
 * @param rpcUrl - Fork RPC URL
 */
export function createEnsClients(rpcUrl: string = DEFAULT_MAINNET_RPC) {
  const transport = http(rpcUrl);

  const publicClient = createPublicClient({
    chain: mainnet,
    transport,
  });

  const testClient = createTestClient({
    chain: mainnet,
    mode: 'anvil',
    transport,
  })
    .extend(publicActions)
    .extend(walletActions);

  return { publicClient, testClient };
}

// ============================================================
// WRITE FUNCTIONS
// ============================================================

/**
 * Rescue config as text records array
 * Format required by @ensdomains/ensjs setRecords
 */
interface TextRecord {
  key: string;
  value: string;
}

/**
 * Convert RescuePolicy to ENS text records format
 * 
 * @param policy - Rescue policy to convert
 * @returns Array of text records for setRecords
 */
export function policyToTextRecords(policy: RescuePolicy): TextRecord[] {
  return [
    { key: ENS_KEYS.ENABLED, value: policy.enabled.toString() },
    { key: ENS_KEYS.MIN_HF, value: policy.minHF.toString() },
    { key: ENS_KEYS.TARGET_HF, value: policy.targetHF.toString() },
    { key: ENS_KEYS.MAX_AMOUNT, value: policy.maxAmountUSD.toString() },
    { key: ENS_KEYS.COOLDOWN, value: policy.cooldownSeconds.toString() },
    { key: ENS_KEYS.ALLOWED_TOKENS, value: policy.allowedTokens.join(',') },
    { key: ENS_KEYS.ALLOWED_CHAINS, value: policy.allowedChains.join(',') },
  ];
}

/**
 * Set rescue configuration on an ENS name
 * 
 * ============================================================
 * DEMO-ONLY: Uses impersonation
 * ============================================================
 * 
 * On a fork, this impersonates the ENS name owner to write records.
 * On mainnet, the caller must actually own the ENS name.
 * 
 * @param ensName - The ENS name to configure (e.g., 'nick.eth')
 * @param policy - Rescue policy to set
 * @param options - Optional configuration
 * @returns Transaction hash
 */
export async function setRescueConfig(
  ensName: string,
  policy: RescuePolicy,
  options: {
    rpcUrl?: string;
    resolverAddress?: `0x${string}`;
  } = {}
): Promise<string> {
  const { rpcUrl = DEFAULT_MAINNET_RPC, resolverAddress = PUBLIC_RESOLVER } = options;

  // Create clients
  const { publicClient, testClient } = createEnsClients(rpcUrl);

  // Resolve ENS name to owner address
  const ownerAddress = await publicClient.getEnsAddress({
    name: normalize(ensName),
  });

  if (!ownerAddress) {
    throw new Error(`ENS name ${ensName} did not resolve to an address`);
  }

  console.log(`ENS name ${ensName} resolves to ${ownerAddress}`);

  // Impersonate the owner (DEMO-ONLY)
  // This allows writing records without actually owning the ENS name
  await testClient.impersonateAccount({ address: ownerAddress });
  console.log(`Impersonating ${ownerAddress} for ENS write`);

  // Create wallet client for the impersonated account
  const wallet = createWalletClient({
    account: ownerAddress,
    chain: addEnsContracts(mainnet),
    transport: http(rpcUrl),
  });

  // Convert policy to text records
  const texts = policyToTextRecords(policy);

  console.log('Setting text records:');
  for (const { key, value } of texts) {
    console.log(`  ${key}: ${value}`);
  }

  // Write the records
  const hash = await setRecords(wallet, {
    name: ensName,
    account: ownerAddress,
    texts,
    resolverAddress,
  });

  console.log(`Transaction hash: ${hash}`);

  return hash;
}

/**
 * Read rescue config immediately after setting (verification)
 * 
 * Useful for confirming writes succeeded on the fork.
 * 
 * @param ensName - The ENS name to read
 * @param rpcUrl - Fork RPC URL
 * @returns Object with key-value pairs
 */
export async function verifyRescueConfig(
  ensName: string,
  rpcUrl: string = DEFAULT_MAINNET_RPC
): Promise<Record<string, string | null>> {
  const { publicClient } = createEnsClients(rpcUrl);
  const results: Record<string, string | null> = {};

  const keys = Object.values(ENS_KEYS);
  
  for (const key of keys) {
    const value = await publicClient.getEnsText({
      name: normalize(ensName),
      key,
    });
    results[key] = value ?? null;
    console.log(`${key}: ${value ?? '(not set)'}`);
  }

  return results;
}
