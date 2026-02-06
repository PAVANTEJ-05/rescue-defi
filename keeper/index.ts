/**
 * Rescue.ETH Keeper - Bootstrap & Entry Point
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Loads configuration from environment
 * - Creates providers and signer
 * - Starts the continuous monitoring loop
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT contain business logic (see loop/tick.ts)
 * - Does NOT manage timing (see loop/runner.ts)
 * - Does NOT modify ENS/Aave/LI.FI logic
 * 
 * ============================================================
 * ARCHITECTURE:
 * ============================================================
 * - index.ts (this file) → Bootstrap only
 * - loop/tick.ts → One monitoring cycle
 * - loop/runner.ts → Infinite loop with timing
 * - aave/ → Health factor monitoring
 * - ens/ → Policy configuration
 * - lifi/ → Transaction execution
 * ============================================================
 */

import { JsonRpcProvider, Wallet } from 'ethers';
import { config } from 'dotenv';

// Config
import type { MonitoredUser } from './config/types.js';
import { getChainConfig } from './config/chains.js';

// Loop
import { runForever, type TickContext, type RunnerConfig } from './loop/index.js';

// Utils
import { logger } from './utils/logger.js';

// Load environment variables
config();

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Keeper configuration from environment
 */
interface KeeperConfig {
  /** Keeper private key */
  privateKey: string;
  /** RescueExecutor contract address */
  executorAddress: string;
  /** Chain ID to operate on */
  chainId: number;
  /** RPC URL override (optional) */
  rpcUrl?: string | undefined;
  /** Polling interval in milliseconds */
  pollIntervalMs: number;
  /** Demo mode - use defaults if ENS missing */
  demoMode: boolean;
}

/**
 * Load configuration from environment
 */
function loadConfig(): KeeperConfig {
  const privateKey = process.env['KEEPER_PRIVATE_KEY'];
  if (!privateKey) {
    throw new Error('KEEPER_PRIVATE_KEY environment variable required');
  }

  const executorAddress = process.env['EXECUTOR_ADDRESS'];
  if (!executorAddress) {
    throw new Error('EXECUTOR_ADDRESS environment variable required');
  }

  return {
    privateKey,
    executorAddress,
    chainId: parseInt(process.env['CHAIN_ID'] || '1', 10),
    rpcUrl: process.env['RPC_URL'],
    pollIntervalMs: parseInt(process.env['POLL_INTERVAL_MS'] || '30000', 10),
    demoMode: process.env['DEMO_MODE'] === 'true',
  };
}

// ============================================================
// MONITORED USERS
// ============================================================

/**
 * Load monitored users
 * 
 * In production, this would come from:
 * - A registry contract
 * - An off-chain database
 * - Event scanning
 * 
 * For demo, users are hardcoded here.
 */
function loadMonitoredUsers(): MonitoredUser[] {
  // Demo users to monitor
  // Add users here in format: { address: '0x...', ensName: 'user.eth' }
  const users: MonitoredUser[] = [
    // Example:
    // { address: '0x1234...', ensName: 'alice.eth' },
    // { address: '0x5678...', ensName: 'bob.eth' },
  ];

  return users;
}

// ============================================================
// BOOTSTRAP
// ============================================================

/**
 * Bootstrap and start the keeper
 */
async function bootstrap(): Promise<void> {
  logger.keeper.info('='.repeat(50));
  logger.keeper.info('Rescue.ETH Keeper Starting');
  logger.keeper.info('='.repeat(50));

  // Load config
  const keeperConfig = loadConfig();
  const chainConfig = getChainConfig(keeperConfig.chainId);

  logger.keeper.info('Configuration loaded', {
    chain: chainConfig.name,
    chainId: keeperConfig.chainId,
    executor: keeperConfig.executorAddress.slice(0, 10) + '...',
    pollIntervalMs: keeperConfig.pollIntervalMs,
    demoMode: keeperConfig.demoMode,
  });

  // Setup providers
  const rpcUrl = keeperConfig.rpcUrl || chainConfig.rpcUrl;
  const provider = new JsonRpcProvider(rpcUrl);
  const mainnetProvider = new JsonRpcProvider('https://eth.llamarpc.com'); // ENS always on mainnet

  // Setup signer
  const signer = new Wallet(keeperConfig.privateKey, provider);
  const keeperAddress = await signer.getAddress();
  
  logger.keeper.info('Keeper wallet initialized', {
    address: keeperAddress.slice(0, 10) + '...',
  });

  // Load monitored users
  const monitoredUsers = loadMonitoredUsers();
  
  if (monitoredUsers.length === 0) {
    logger.keeper.warn('No users configured to monitor');
    logger.keeper.warn('Add users to loadMonitoredUsers() in index.ts');
    logger.keeper.info('Keeper will run but tick will be a no-op');
  } else {
    logger.keeper.info('Monitored users loaded', {
      count: monitoredUsers.length,
    });
  }

  // Build tick context
  const tickContext: TickContext = {
    chainConfig,
    provider,
    mainnetProvider,
    signer,
    executorAddress: keeperConfig.executorAddress,
    demoMode: keeperConfig.demoMode,
    monitoredUsers,
  };

  // Build runner config
  const runnerConfig: RunnerConfig = {
    pollIntervalMs: keeperConfig.pollIntervalMs,
    tickContext,
  };

  logger.keeper.info('='.repeat(50));
  logger.keeper.info('Starting continuous monitoring loop');
  logger.keeper.info('Press Ctrl+C to stop gracefully');
  logger.keeper.info('='.repeat(50));

  // Start the infinite loop (this never returns unless shutdown)
  await runForever(runnerConfig);
}

// ============================================================
// ENTRY POINT
// ============================================================

bootstrap().catch((error) => {
  logger.keeper.error('Fatal bootstrap error', {
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
