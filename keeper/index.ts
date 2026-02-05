/**
 * Rescue.ETH Keeper Main Loop
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Orchestrates the full rescue flow end-to-end
 * - Reads user health factor from Aave V3
 * - Reads rescue policy from ENS text records
 * - Computes required supply amount
 * - Fetches LI.FI quote for token routing
 * - Submits transaction via RescueExecutor
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT discover users automatically (users must be registered)
 * - Does NOT handle user onboarding (approvals, ENS setup)
 * 
 * ============================================================
 * CRITICAL ARCHITECTURAL NOTE:
 * ============================================================
 * LI.FI is a ROUTING/BRIDGING service - it moves tokens between chains/dexes.
 * LI.FI does NOT automatically supply tokens to Aave.
 * 
 * For a rescue to actually supply collateral to Aave, ONE of these must happen:
 * 
 * Option A: LI.FI Hooks (if supported)
 *   - Some LI.FI routes support "post-swap hooks"
 *   - The hook would call AavePool.supply() after the swap
 *   - This requires LI.FI to support the destination call
 * 
 * Option B: Two-step execution
 *   - Step 1: LI.FI routes/swaps tokens to destination chain
 *   - Step 2: Separate call to AavePool.supply()
 *   - RescueExecutor would need modification
 * 
 * Option C: Direct supply (no LI.FI for same-chain)
 *   - If user already has the right token on the right chain
 *   - Skip LI.FI entirely, call AavePool.supply() directly
 *   - This is the simplest path for same-chain rescues
 * 
 * CURRENT STATE: This code fetches LI.FI quote but the final
 * AavePool.supply() step is NOT implemented. The rescued tokens
 * would arrive but NOT be deposited as collateral.
 * 
 * TODO: Implement the Aave supply step (Option B or C)
 * ============================================================
 * 
 * Flow:
 * 1. For each monitored user ENS name
 * 2. Read ENS policy configuration
 * 3. Check if chain is allowed by policy
 * 4. Check cooldown
 * 5. Read Aave health factor
 * 6. If HF >= minHF → skip (healthy)
 * 7. Compute required collateral supply
 * 8. Select token from policy.allowedTokens
 * 9. Fetch LI.FI route (for cross-chain/swap)
 * 10. Execute via RescueExecutor
 * 
 * Rules:
 * - Stateless (no database)
 * - Deterministic
 * - Idempotent
 * - Keeper pays gas and msg.value
 */

import { JsonRpcProvider, Wallet, type Provider, type Signer } from 'ethers';
import { config } from 'dotenv';

// Config
import type { RescuePolicy, MonitoredUser, RescueResult } from './config/types.js';
import { getChainConfig, getTokenAddress, CHAIN_IDS } from './config/chains.js';

// Aave
import { getUserAccountData, needsRescue, getRiskLevel } from './aave/monitor.js';
import { computeRequiredSupply, estimateNewHealthFactor } from './aave/math.js';

// ENS
import { readEnsConfig } from './ens/reader.js';
import { parseEnsConfig, isChainAllowed } from './ens/parser.js';

// LI.FI
import { getQuote, isValidQuoteTarget } from './lifi/quote.js';
import { executeRescue, isCooldownPassed, type ExecuteParams } from './lifi/execute.js';

// Utils
import { logger } from './utils/logger.js';
import { usdToTokenUnits } from './utils/units.js';

// Load environment variables
config();

/**
 * Token info for selection
 */
interface TokenInfo {
  symbol: string;
  decimals: number;
}

/**
 * Token decimals by symbol (common tokens)
 * In production, this would come from on-chain or a token list API
 */
const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  WETH: 18,
  WBTC: 8,
};

/**
 * Select first allowed token that exists on the target chain
 * 
 * @param allowedTokens - Token symbols from ENS policy
 * @param chainId - Target chain ID
 * @returns Token info or null if none available
 */
function selectTokenFromPolicy(allowedTokens: string[], chainId: number): TokenInfo | null {
  for (const symbol of allowedTokens) {
    // Check if token exists on this chain
    const address = getTokenAddress(chainId, symbol);
    if (address) {
      const decimals = TOKEN_DECIMALS[symbol] || 18;
      return { symbol, decimals };
    }
  }
  return null;
}

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
    pollIntervalMs: parseInt(process.env['POLL_INTERVAL_MS'] || '60000', 10),
    demoMode: process.env['DEMO_MODE'] === 'true',
  };
}

/**
 * Process a single user - check if rescue needed and execute
 */
async function processUser(
  user: MonitoredUser,
  chainConfig: ReturnType<typeof getChainConfig>,
  provider: Provider,
  mainnetProvider: Provider,
  signer: Signer,
  executorAddress: string,
  demoMode: boolean
): Promise<RescueResult | null> {
  const { address: userAddress, ensName } = user;

  logger.keeper.info('Processing user', { user: userAddress.slice(0, 10), ens: ensName });

  // Step 1: Read ENS policy (always from mainnet)
  const rawConfig = await readEnsConfig(ensName, mainnetProvider);
  if (!rawConfig && !demoMode) {
    logger.keeper.warn('No ENS config found, skipping', { ens: ensName });
    return null;
  }

  const policy = parseEnsConfig(rawConfig || {}, demoMode);
  if (!policy) {
    logger.keeper.error('Failed to parse ENS config', { ens: ensName });
    return null;
  }

  // Step 2: Check if chain is allowed by policy
  if (!isChainAllowed(chainConfig.chainId, policy)) {
    logger.keeper.debug('Chain not allowed by policy', {
      chainId: chainConfig.chainId,
      allowed: policy.allowedChains,
    });
    return null;
  }

  // Step 3: Check cooldown
  const cooldownPassed = await isCooldownPassed(
    executorAddress,
    userAddress,
    policy.cooldownSeconds,
    signer
  );
  if (!cooldownPassed) {
    logger.keeper.debug('Cooldown active, skipping', { user: userAddress.slice(0, 10) });
    return null;
  }

  // Step 4: Read Aave position
  const accountData = await getUserAccountData(chainConfig.aavePool, userAddress, provider);
  if (!accountData) {
    logger.keeper.error('Failed to read Aave data', { user: userAddress.slice(0, 10) });
    return null;
  }

  // Step 5: Check if rescue needed
  if (!needsRescue(accountData, policy.minHF)) {
    logger.keeper.debug('Position healthy, skipping', {
      user: userAddress.slice(0, 10),
      hf: accountData.healthFactor.toFixed(4),
      minHF: policy.minHF,
    });
    return null;
  }

  logger.keeper.info('Rescue needed', {
    user: userAddress.slice(0, 10),
    hf: accountData.healthFactor.toFixed(4),
    risk: getRiskLevel(accountData.healthFactor),
  });

  // Step 6: Compute required supply
  const supplyCalc = computeRequiredSupply(accountData, policy);
  if (supplyCalc.amountUSD <= 0) {
    logger.keeper.debug('No supply needed', { reason: supplyCalc.reason });
    return null;
  }

  logger.keeper.info('Supply calculation', {
    amountUSD: supplyCalc.amountUSD.toFixed(2),
    reason: supplyCalc.reason,
    estimatedNewHF: estimateNewHealthFactor(accountData, supplyCalc.amountUSD).toFixed(4),
  });

  // Step 7: Determine token to use from ENS allowedTokens
  // Policy lists which tokens the user approves for rescue
  // We pick the first one that exists on this chain
  const supplyToken = selectTokenFromPolicy(policy.allowedTokens, chainConfig.chainId);
  if (!supplyToken) {
    logger.keeper.error('No allowed token available on chain', {
      allowedTokens: policy.allowedTokens,
      chainId: chainConfig.chainId,
    });
    return null;
  }

  const tokenAddress = getTokenAddress(chainConfig.chainId, supplyToken.symbol);
  if (!tokenAddress) {
    logger.keeper.error('Token address not found', {
      token: supplyToken.symbol,
      chainId: chainConfig.chainId,
    });
    return null;
  }

  logger.keeper.info('Selected token from policy', {
    symbol: supplyToken.symbol,
    decimals: supplyToken.decimals,
    address: tokenAddress.slice(0, 10),
  });

  // Convert USD to token units
  // TODO: Fetch actual token price from oracle/API instead of assuming $1
  const tokenPrice = 1.0; // CRITICAL: This assumes all tokens = $1 (only valid for stablecoins)
  const tokenAmount = usdToTokenUnits(supplyCalc.amountUSD, tokenPrice, supplyToken.decimals);

  // Step 8: Get LI.FI quote
  // 
  // IMPORTANT: LI.FI is for ROUTING - cross-chain bridges and DEX swaps.
  // For same-chain, same-token operations, LI.FI is unnecessary overhead.
  // 
  // Current behavior: We request a quote even for same-chain same-token,
  // which LI.FI may reject or return a no-op. This is a known limitation.
  //
  // TODO: For same-chain rescues where user already has the right token,
  // skip LI.FI entirely and call AavePool.supply() directly.
  //
  const isSameChainSameToken = true; // Simplified: we're always using same chain for now
  
  if (isSameChainSameToken) {
    logger.keeper.warn('Same-chain same-token rescue - LI.FI not needed', {
      note: 'TODO: Implement direct AavePool.supply() path',
    });
    // For now, we still try LI.FI, but this should be refactored
  }

  const quote = await getQuote({
    fromChain: chainConfig.chainId,
    toChain: chainConfig.chainId,
    fromToken: tokenAddress,
    toToken: tokenAddress, // Same token - this is suboptimal, see note above
    fromAmount: tokenAmount.toString(),
    fromAddress: userAddress,
    toAddress: userAddress,
  });

  if (!quote) {
    logger.keeper.error('Failed to get LI.FI quote');
    return null;
  }

  // Validate quote target
  if (!isValidQuoteTarget(quote, chainConfig.lifiRouter)) {
    logger.keeper.error('Quote target mismatch', {
      expected: chainConfig.lifiRouter,
      got: quote.to,
    });
    return null;
  }

  // Step 9: Execute rescue
  const executeParams: ExecuteParams = {
    userAddress,
    tokenIn: tokenAddress,
    amountIn: tokenAmount,
    quote,
    amountUSD: supplyCalc.amountUSD,
  };

  return executeRescue(executorAddress, executeParams, signer);
}

/**
 * Main keeper loop
 */
async function runKeeper(): Promise<void> {
  logger.keeper.info('Starting Rescue.ETH Keeper');

  // Load config
  const config = loadConfig();
  const chainConfig = getChainConfig(config.chainId);

  logger.keeper.info('Configuration loaded', {
    chain: chainConfig.name,
    chainId: config.chainId,
    executor: config.executorAddress.slice(0, 10),
    pollInterval: config.pollIntervalMs,
    demoMode: config.demoMode,
  });

  // Setup providers and signer
  const rpcUrl = config.rpcUrl || chainConfig.rpcUrl;
  const provider = new JsonRpcProvider(rpcUrl);
  const mainnetProvider = new JsonRpcProvider('https://eth.llamarpc.com'); // ENS always on mainnet
  const signer = new Wallet(config.privateKey, provider);

  const keeperAddress = await signer.getAddress();
  logger.keeper.info('Keeper wallet', { address: keeperAddress.slice(0, 10) });

  // Demo users to monitor (in production, this would come from a registry or events)
  const monitoredUsers: MonitoredUser[] = [
    // Add users to monitor here
    // { address: '0x...', ensName: 'user.eth' },
  ];

  // Check if we have users to monitor
  if (monitoredUsers.length === 0) {
    logger.keeper.warn('No users configured to monitor');
    logger.keeper.info('Add users to monitoredUsers array in index.ts');
    logger.keeper.info('Keeper ready but idle');
    return;
  }

  // Main loop
  async function loop(): Promise<void> {
    logger.keeper.info('Starting monitoring cycle', { users: monitoredUsers.length });

    for (const user of monitoredUsers) {
      try {
        const result = await processUser(
          user,
          chainConfig,
          provider,
          mainnetProvider,
          signer,
          config.executorAddress,
          config.demoMode
        );

        if (result?.success) {
          logger.keeper.info('Rescue successful', {
            user: user.address.slice(0, 10),
            txHash: result.txHash,
            amountUSD: result.amountUSD.toFixed(2),
          });
        }
      } catch (error) {
        logger.keeper.error('Error processing user', {
          user: user.address.slice(0, 10),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.keeper.info('Monitoring cycle complete');
  }

  // Run immediately, then schedule
  await loop();

  // Schedule recurring execution
  setInterval(loop, config.pollIntervalMs);

  logger.keeper.info('Keeper running', { interval: `${config.pollIntervalMs}ms` });
}

// Entry point
runKeeper().catch((error) => {
  logger.keeper.error('Fatal error', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exit(1);
});
