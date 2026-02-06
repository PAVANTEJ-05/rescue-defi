/**
 * ENS Demo Script for Rescue.ETH
 * 
 * ============================================================
 * DEMO-ONLY - DO NOT USE IN PRODUCTION
 * ============================================================
 * 
 * This script demonstrates the ENS integration:
 * 1. Resolve an ENS name to get the owner address
 * 2. Impersonate the owner on a fork
 * 3. Write rescue configuration text records
 * 4. Read back and verify the records
 * 
 * PREREQUISITES:
 * - Anvil mainnet fork running on port 8546
 * - Start with: anvil --fork-url <MAINNET_RPC> --port 8546
 * 
 * RUN WITH:
 *   cd keeper && npx tsx ens/demo.ts
 * 
 * ============================================================
 * ORIGINAL FILE: keeper/ens/index.ts
 * This is the restructured demo code from the original file.
 * Core ENS write/read flow is UNCHANGED.
 * ============================================================
 */

import { addEnsContracts } from '@ensdomains/ensjs';
import { setRecords } from '@ensdomains/ensjs/wallet';
import {
  createWalletClient,
  createPublicClient,
  createTestClient,
  http,
  publicActions,
  walletActions,
} from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Fork RPC URL
 * Must be a mainnet fork with impersonation support (Anvil)
 */
const FORK_RPC = 'http://127.0.0.1:8546';

/**
 * ENS name to use for demo
 * nick.eth is a well-known ENS name for testing
 */
const DEMO_ENS_NAME = 'nick.eth';

/**
 * Public ENS resolver address
 */
const RESOLVER_ADDRESS = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';

// ============================================================
// CLIENT SETUP
// ============================================================

const transport = http(FORK_RPC);

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

// ============================================================
// DEMO RESCUE CONFIGURATION
// ============================================================

/**
 * Example rescue configuration records
 * 
 * These are the text records that control rescue behavior:
 * - rescue.minHF: Trigger rescue when HF drops below this
 * - rescue.targetHF: Supply enough to reach this HF
 * - rescue.maxAmount: Maximum USD value per rescue
 * - rescue.cooldown: Seconds between rescues
 */
const rescueConfigRecords = [
  { key: 'rescue.minHF', value: '1.2' },
  { key: 'rescue.targetHF', value: '1.5' },
  { key: 'rescue.maxAmount', value: '1.2' },
  { key: 'rescue.cooldown', value: '500' },
];

// ============================================================
// MAIN DEMO FUNCTION
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Rescue.ETH ENS Demo');
  console.log('='.repeat(60));
  console.log('');
  console.log('This demo shows:');
  console.log('  1. Resolving ENS name to address');
  console.log('  2. Impersonating the owner (fork only)');
  console.log('  3. Writing rescue config text records');
  console.log('  4. Reading back and verifying records');
  console.log('');
  console.log('='.repeat(60));

  // Step 1: Resolve ENS name
  console.log(`\nResolving ${DEMO_ENS_NAME}...`);
  
  const ensAddress = await publicClient.getEnsAddress({
    name: normalize(DEMO_ENS_NAME),
  });

  console.log(`  Address: ${ensAddress}`);

  if (!ensAddress) {
    throw new Error(`ENS name ${DEMO_ENS_NAME} did not resolve to an address`);
  }

  // Step 2: Impersonate the owner
  console.log(`\nImpersonating ${ensAddress}...`);
  await testClient.impersonateAccount({ address: ensAddress });
  console.log('  Impersonation successful (fork only!)');

  // Step 3: Create wallet client for writing
  const wallet = createWalletClient({
    account: ensAddress,
    chain: addEnsContracts(mainnet),
    transport,
  });

  // Step 4: Write rescue configuration
  console.log('\nWriting rescue configuration records...');
  console.log('  Records to write:');
  for (const { key, value } of rescueConfigRecords) {
    console.log(`    ${key}: ${value}`);
  }

  const hash = await setRecords(wallet, {
    name: DEMO_ENS_NAME,
    account: ensAddress,
    texts: rescueConfigRecords,
    resolverAddress: RESOLVER_ADDRESS,
  });

  console.log(`\n  Transaction hash: ${hash}`);

  // Step 5: Read back and verify
  console.log('\nVerifying records were written...');

  for (const { key } of rescueConfigRecords) {
    const ensText = await publicClient.getEnsText({
      name: normalize(DEMO_ENS_NAME),
      key,
    });
    console.log(`  ${key}: ${ensText}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Demo complete');
  console.log('='.repeat(60));
  console.log('');
  console.log('IMPORTANT NOTES:');
  console.log('  - This only works on a FORKED network');
  console.log('  - Real ENS writes require owning the name');
  console.log('  - Users configure via app.ens.domains');
  console.log('  - Keeper only READS these records');
}

// ============================================================
// ENTRY POINT
// ============================================================

main().catch(console.error);
