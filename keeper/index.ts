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
 * PRODUCTION SAFETY:
 * ============================================================
 * - Users must have rescue.enabled=true in ENS
 * - Only stablecoins are supported (price = $1)
 * - Capped rescues that won't restore HF are REJECTED
 * - Cooldown is enforced by contract (off-chain is informational)
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
import { createConfig as createLiFiConfig } from '@lifi/sdk';

// Config
import type { MonitoredUser } from './config/types.js';
import { getChainConfig } from './config/chains.js';

// Loop
import { runForever, type TickContext, type RunnerConfig } from './loop/index.js';

// Cross-chain rescue (execute.ts integration)
import { loadCrossChainConfig } from './lifi/crosschain-rescue.js';

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
  /** Demo mode - use defaults if ENS missing (does NOT bypass consent) */
  demoMode: boolean;
}

/**
 * Load configuration from environment
 * 
 * CRITICAL: All required environment variables are validated here.
 * Missing or invalid values will cause the keeper to fail fast at startup.
 */
function loadConfig(): KeeperConfig {
  // Validate KEEPER_PRIVATE_KEY
  const privateKey = process.env['KEEPER_PRIVATE_KEY'];
  if (!privateKey) {
    throw new Error('KEEPER_PRIVATE_KEY environment variable required');
  }
  
  // Validate private key format (should be 64 hex chars with optional 0x prefix)
  const cleanPrivateKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  if (!/^[a-fA-F0-9]{64}$/.test(cleanPrivateKey)) {
    throw new Error('KEEPER_PRIVATE_KEY must be a valid 32-byte hex string');
  }

  // Validate EXECUTOR_ADDRESS
  const executorAddress = process.env['EXECUTOR_ADDRESS'];
  if (!executorAddress) {
    throw new Error('EXECUTOR_ADDRESS environment variable required');
  }

  // Validate executor address format
  if (!executorAddress.startsWith('0x') || executorAddress.length !== 42) {
    throw new Error('EXECUTOR_ADDRESS must be a valid Ethereum address (0x + 40 hex chars)');
  }
  
  // Validate address is valid hex
  if (!/^0x[a-fA-F0-9]{40}$/.test(executorAddress)) {
    throw new Error('EXECUTOR_ADDRESS contains invalid characters');
  }

  // Validate CHAIN_ID
  const chainIdStr = process.env['CHAIN_ID'] || '1';
  const chainId = parseInt(chainIdStr, 10);
  if (isNaN(chainId) || chainId <= 0) {
    throw new Error(`Invalid CHAIN_ID: ${chainIdStr}`);
  }

  // Validate RPC_URL if provided
  const rpcUrl = process.env['RPC_URL'];
  if (rpcUrl && !rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://') && !rpcUrl.startsWith('ws://') && !rpcUrl.startsWith('wss://')) {
    throw new Error('RPC_URL must be a valid HTTP(S) or WebSocket URL');
  }

  // Validate POLL_INTERVAL_MS
  const pollIntervalStr = process.env['POLL_INTERVAL_MS'] || '30000';
  const pollIntervalMs = parseInt(pollIntervalStr, 10);
  if (isNaN(pollIntervalMs) || pollIntervalMs < 1000) {
    throw new Error('POLL_INTERVAL_MS must be at least 1000ms');
  }

  const demoMode = process.env['DEMO_MODE'] === 'true';

  return {
    privateKey: privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`,
    executorAddress,
    chainId,
    rpcUrl,
    pollIntervalMs,
    demoMode,
  };
}

// ============================================================
// MONITORED USERS
// ============================================================

/**
 * Load monitored users
 * 
 * Users can be configured via:
 * - MONITORED_USERS env var: JSON array of {address, ensName} objects
 *   Example: MONITORED_USERS='[{"address":"0x123...","ensName":"alice.eth"}]'
 * - Hardcoded fallback (demo only, warns loudly)
 * 
 * In production, implement one of:
 * - A registry contract (on-chain discovery)
 * - An off-chain database / API
 * - Event scanning for approval events on the executor
 */
function loadMonitoredUsers(): MonitoredUser[] {
  const envUsers = process.env['MONITORED_USERS'];
  
  if (envUsers) {
    try {
      const parsed = JSON.parse(envUsers) as MonitoredUser[];
      if (!Array.isArray(parsed)) {
        throw new Error('MONITORED_USERS must be a JSON array');
      }
      // Validate each user
      for (const user of parsed) {
        if (!user.address || !user.address.startsWith('0x') || user.address.length !== 42) {
          throw new Error(`Invalid user address: ${user.address}`);
        }
        if (user.ensName === undefined) {
          user.ensName = '';
        }
      }
      logger.keeper.info('Loaded monitored users from MONITORED_USERS env var', {
        count: parsed.length,
      });
      return parsed;
    } catch (error) {
      throw new Error(`Failed to parse MONITORED_USERS: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // Fallback: hardcoded demo users (warn loudly)
  logger.keeper.warn('MONITORED_USERS env var not set — using hardcoded demo list');
  logger.keeper.warn('For production, set MONITORED_USERS as a JSON array');
  
  const users: MonitoredUser[] = [
    { address: '0xcaf4bfb53e07fd02e7e46894564d7caac3d9b35b', ensName: 'nick.eth' },
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
  logger.keeper.info('='.repeat(60));
  logger.keeper.info('Rescue.ETH Keeper Starting - PRODUCTION MODE');
  logger.keeper.info('='.repeat(60));

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

  // Initialize LI.FI SDK - required before calling getContractCallsQuote
  // Only the integrator name is needed; RPC URLs are not required for API calls.
  // The SDK uses its own routing API (li.quest) to compute quotes.
  createLiFiConfig({ integrator: 'rescue-eth' });
  logger.keeper.info('LI.FI SDK initialized');

  // PRODUCTION SAFETY WARNINGS
  if (keeperConfig.demoMode) {
    logger.keeper.warn('='.repeat(60));
    logger.keeper.warn('DEMO MODE ENABLED');
    logger.keeper.warn('Fallback defaults will be used if ENS records missing');
    logger.keeper.warn('Users STILL require rescue.enabled=true to be rescued');
    logger.keeper.warn('='.repeat(60));
  } else {
    logger.keeper.info('Production mode: Users must configure ENS records');
    logger.keeper.info('Required: rescue.enabled=true for any rescue to execute');
  }

  // Setup providers
  const rpcUrl = keeperConfig.rpcUrl || chainConfig.rpcUrl;
  const provider = new JsonRpcProvider(rpcUrl);
  
  // ENS is always on mainnet — use dedicated mainnet RPC
  const mainnetRpcUrl = process.env['MAINNET_RPC_URL'] || 'https://eth.llamarpc.com';
  const mainnetProvider = new JsonRpcProvider(mainnetRpcUrl);

  if (!process.env['MAINNET_RPC_URL']) {
    logger.keeper.warn('MAINNET_RPC_URL not set — using public fallback (https://eth.llamarpc.com)');
    logger.keeper.warn('For production, set MAINNET_RPC_URL to a dedicated mainnet RPC endpoint');
  }

  // Validate provider connections
  try {
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== keeperConfig.chainId) {
      throw new Error(`Provider chainId ${network.chainId} does not match config ${keeperConfig.chainId}`);
    }
    logger.keeper.info('Provider connected', { 
      chainId: Number(network.chainId),
      rpcUrl: rpcUrl.slice(0, 30) + '...',
    });
  } catch (error) {
    throw new Error(`Failed to connect to provider: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  // Setup signer
  const signer = new Wallet(keeperConfig.privateKey, provider);
  const keeperAddress = await signer.getAddress();
  
  // Log keeper address for verification
  logger.keeper.info('Keeper wallet initialized', {
    address: keeperAddress,
    shortAddress: keeperAddress.slice(0, 10) + '...',
  });

  // Verify keeper has some ETH for gas (warning only, don't block)
  try {
    const balance = await provider.getBalance(keeperAddress);
    const balanceEth = Number(balance) / 1e18;
    if (balanceEth < 0.01) {
      logger.keeper.warn('LOW KEEPER BALANCE: Keeper wallet has very low ETH balance', {
        address: keeperAddress,
        balanceEth: balanceEth.toFixed(6),
        recommendation: 'Fund the keeper wallet with at least 0.1 ETH for gas',
      });
    } else {
      logger.keeper.info('Keeper balance verified', {
        balanceEth: balanceEth.toFixed(4),
      });
    }
  } catch (error) {
    logger.keeper.warn('Could not verify keeper balance', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  // Load monitored users
  const monitoredUsers = loadMonitoredUsers();
  
  if (monitoredUsers.length === 0) {
    logger.keeper.warn('No users configured to monitor');
    logger.keeper.warn('Add users to loadMonitoredUsers() in index.ts');
    logger.keeper.info('Keeper will run but tick will be a no-op');
  } else {
    logger.keeper.info('Monitored users loaded', {
      count: monitoredUsers.length,
      users: monitoredUsers.map(u => u.ensName || u.address.slice(0, 10) + '...'),
    });
  }

  // Load cross-chain rescue configuration (execute.ts integration)
  const crossChainConfig = loadCrossChainConfig();
  if (crossChainConfig) {
    logger.keeper.info('Cross-chain rescue ENABLED (execute.ts integration)', {
      destChainId: crossChainConfig.destChainId,
      sourceToken: crossChainConfig.sourceTokenAddress.slice(0, 10) + '...',
      destToken: crossChainConfig.destTokenAddress.slice(0, 10) + '...',
      amount: crossChainConfig.amount.toString(),
      destAavePool: crossChainConfig.destAavePool.slice(0, 10) + '...',
    });
  } else {
    logger.keeper.info('Cross-chain rescue disabled (same-chain mode)');
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
    ...(crossChainConfig ? { crossChainConfig } : {}),
  };

  // Build runner config
  const runnerConfig: RunnerConfig = {
    pollIntervalMs: keeperConfig.pollIntervalMs,
    tickContext,
  };

  logger.keeper.info('='.repeat(60));
  logger.keeper.info('PRODUCTION SAFETY INVARIANTS:');
  logger.keeper.info('  1. Users must have rescue.enabled=true in ENS');
  logger.keeper.info('  2. Only stablecoins (USDC, USDT, DAI) are supported');
  logger.keeper.info('  3. Capped rescues that won\'t restore HF are REJECTED');
  logger.keeper.info('  4. Cooldown is enforced by on-chain contract');
  logger.keeper.info('  5. Non-stablecoin tokens are filtered at parse time');
  logger.keeper.info('  6. Aave base currency (8 decimals) is validated');
  logger.keeper.info('='.repeat(60));
  logger.keeper.info('Starting continuous monitoring loop');
  logger.keeper.info('Press Ctrl+C to stop gracefully');
  logger.keeper.info('='.repeat(60));

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
