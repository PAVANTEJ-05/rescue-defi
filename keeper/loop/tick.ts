/**
 * Keeper Tick - Single Monitoring Cycle
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Executes ONE complete monitoring cycle
 * - Processes all monitored users ONCE
 * - Calls existing business logic (processUser)
 * - Throws errors upward (does not swallow)
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT manage timing or sleep
 * - Does NOT run in a loop
 * - Does NOT manage process lifecycle
 * - Does NOT modify business logic
 * 
 * Think of this as: "What should the bot do right now?"
 * ============================================================
 */

import type { Provider, Signer } from 'ethers';
import type { MonitoredUser, RescueResult, RescuePolicy } from '../config/types.js';
import { getChainConfig, getTokenAddress } from '../config/chains.js';
import { getUserAccountData, needsRescue, getRiskLevel } from '../aave/monitor.js';
import { computeRequiredSupply, estimateNewHealthFactor } from '../aave/math.js';
import { readEnsConfig } from '../ens/reader.js';
import { parseEnsConfig, isChainAllowed } from '../ens/parser.js';
import { getQuote, isValidQuoteTarget } from '../lifi/quote.js';
import { executeRescue, isCooldownPassed, type ExecuteParams } from '../lifi/execute.js';
import { logger } from '../utils/logger.js';
import { usdToTokenUnits } from '../utils/units.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Token info for selection
 */
interface TokenInfo {
  symbol: string;
  decimals: number;
}

/**
 * Context required to run a tick
 */
export interface TickContext {
  /** Chain configuration */
  chainConfig: ReturnType<typeof getChainConfig>;
  /** Provider for target chain */
  provider: Provider;
  /** Provider for mainnet (ENS) */
  mainnetProvider: Provider;
  /** Signer for transactions */
  signer: Signer;
  /** RescueExecutor contract address */
  executorAddress: string;
  /** Demo mode flag */
  demoMode: boolean;
  /** Users to monitor */
  monitoredUsers: MonitoredUser[];
}

/**
 * Result of a tick execution
 */
export interface TickResult {
  /** Total users processed */
  usersProcessed: number;
  /** Number of rescues attempted */
  rescuesAttempted: number;
  /** Number of successful rescues */
  rescuesSucceeded: number;
  /** Errors encountered (user address -> error message) */
  errors: Map<string, string>;
}

// ============================================================
// CONSTANTS
// ============================================================

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

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Select first allowed token that exists on the target chain
 */
function selectTokenFromPolicy(allowedTokens: string[], chainId: number): TokenInfo | null {
  for (const symbol of allowedTokens) {
    const address = getTokenAddress(chainId, symbol);
    if (address) {
      const decimals = TOKEN_DECIMALS[symbol] || 18;
      return { symbol, decimals };
    }
  }
  return null;
}

// ============================================================
// PROCESS USER (UNCHANGED LOGIC)
// ============================================================

/**
 * Process a single user - check if rescue needed and execute
 * 
 * NOTE: This is the EXACT same logic from index.ts, extracted here.
 * Business logic is UNCHANGED.
 */
async function processUser(
  user: MonitoredUser,
  ctx: TickContext
): Promise<RescueResult | null> {
  const { address: userAddress, ensName } = user;
  const { chainConfig, provider, mainnetProvider, signer, executorAddress, demoMode } = ctx;

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
  const isSameChainSameToken = true; // Simplified: we're always using same chain for now
  
  if (isSameChainSameToken) {
    logger.keeper.warn('Same-chain same-token rescue - LI.FI not needed', {
      note: 'TODO: Implement direct AavePool.supply() path',
    });
  }

  const quote = await getQuote({
    fromChain: chainConfig.chainId,
    toChain: chainConfig.chainId,
    fromToken: tokenAddress,
    toToken: tokenAddress,
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

// ============================================================
// TICK FUNCTION
// ============================================================

/**
 * Execute one monitoring cycle
 * 
 * Processes all monitored users once. Does NOT loop or sleep.
 * Errors for individual users are caught and logged, not thrown.
 * 
 * @param ctx - Tick context with providers, signer, and users
 * @returns Result summary of the tick
 */
export async function tick(ctx: TickContext): Promise<TickResult> {
  const { monitoredUsers } = ctx;
  
  const result: TickResult = {
    usersProcessed: 0,
    rescuesAttempted: 0,
    rescuesSucceeded: 0,
    errors: new Map(),
  };

  // Handle empty user list (log warning but don't throw)
  if (monitoredUsers.length === 0) {
    logger.keeper.warn('No users configured to monitor - tick is a no-op');
    return result;
  }

  logger.keeper.info('Starting monitoring cycle', { users: monitoredUsers.length });

  for (const user of monitoredUsers) {
    result.usersProcessed++;

    try {
      const rescueResult = await processUser(user, ctx);

      if (rescueResult) {
        result.rescuesAttempted++;
        
        if (rescueResult.success) {
          result.rescuesSucceeded++;
          logger.keeper.info('Rescue successful', {
            user: user.address.slice(0, 10),
            txHash: rescueResult.txHash,
            amountUSD: rescueResult.amountUSD.toFixed(2),
          });
        } else {
          // Rescue attempted but failed
          const errorMsg = rescueResult.error || 'Unknown error';
          result.errors.set(user.address, errorMsg);
          logger.keeper.error('Rescue failed', {
            user: user.address.slice(0, 10),
            error: errorMsg,
          });
        }
      }
      // If rescueResult is null, user was skipped (healthy, cooldown, etc.)
      
    } catch (error) {
      // Catch any unexpected errors - log and continue to next user
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.set(user.address, errorMsg);
      logger.keeper.error('Error processing user', {
        user: user.address.slice(0, 10),
        error: errorMsg,
      });
      // DO NOT re-throw - continue to next user
    }
  }

  logger.keeper.info('Monitoring cycle complete', {
    processed: result.usersProcessed,
    attempted: result.rescuesAttempted,
    succeeded: result.rescuesSucceeded,
    errors: result.errors.size,
  });

  return result;
}
