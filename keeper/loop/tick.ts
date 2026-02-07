/**
 * Keeper Tick - Single Monitoring Cycle
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Executes ONE complete monitoring cycle
 * - Processes all monitored users ONCE
 * - Enforces all safety invariants before execution
 * - Rejects unsafe partial rescues
 * 
 * ============================================================
 * PRODUCTION SAFETY INVARIANTS:
 * ============================================================
 * - User must have rescue.enabled=true in ENS
 * - Only stablecoins are used (price = $1)
 * - Rescue MUST restore HF >= minHF (no partial unsafe rescues)
 * - Cooldown is informational only (contract enforces)
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
import { getChainConfig, getTokenAddress, isTrustedLiFiTarget, getTrustedLiFiTargets } from '../config/chains.js';
import { isStablecoin } from '../config/defaults.js';
import { getUserAccountData, needsRescue, getRiskLevel } from '../aave/monitor.js';
import { computeRequiredSupply, estimateNewHealthFactor } from '../aave/math.js';
import { readEnsConfig } from '../ens/reader.js';
import { parseEnsConfig, isChainAllowed, validatePolicy } from '../ens/parser.js';
import { getQuote } from '../lifi/quote.js';
import { executeRescue, checkCooldownInfo, type ExecuteParams } from '../lifi/execute.js';
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
  /** Demo mode flag - allows fallback defaults but does NOT bypass consent */
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
  /** Number of users skipped (various reasons) */
  usersSkipped: number;
  /** Errors encountered (user address -> error message) */
  errors: Map<string, string>;
  /** Skip reasons for logging (user address -> reason) */
  skipReasons: Map<string, string>;
}

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Token decimals by symbol (common stablecoins only)
 * 
 * PRODUCTION NOTE: Only stablecoins are supported.
 * Non-stablecoins require price oracle which is NOT implemented.
 */
const STABLECOIN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  FRAX: 18,
  LUSD: 18,
  GUSD: 2,
  USDP: 18,
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Select first allowed STABLECOIN that exists on the target chain
 * 
 * CRITICAL: Only stablecoins are allowed (price = $1 assumption)
 * Non-stablecoins in allowedTokens are silently skipped here
 * (they should have been filtered during ENS parsing)
 */
function selectStablecoinFromPolicy(allowedTokens: string[], chainId: number): TokenInfo | null {
  for (const symbol of allowedTokens) {
    // Double-check it's a stablecoin (should already be filtered)
    if (!isStablecoin(symbol)) {
      logger.keeper.warn('Non-stablecoin in policy, skipping', { symbol });
      continue;
    }

    const address = getTokenAddress(chainId, symbol);
    if (address) {
      const decimals = STABLECOIN_DECIMALS[symbol.toUpperCase()];
      if (decimals === undefined) {
        logger.keeper.warn('Unknown decimals for stablecoin, skipping', { symbol });
        continue;
      }
      return { symbol: symbol.toUpperCase(), decimals };
    }
  }
  return null;
}

/**
 * Reason codes for skipping a user
 */
type SkipReason = 
  | 'no_ens_config'
  | 'rescue_not_enabled'
  | 'chain_not_allowed'
  | 'policy_validation_failed'
  | 'aave_data_unavailable'
  | 'position_healthy'
  | 'no_supply_needed'
  | 'insufficient_cap_for_safety'
  | 'no_valid_stablecoin'
  | 'token_address_not_found'
  | 'quote_failed'
  | 'quote_target_invalid';

// ============================================================
// PROCESS USER (PRODUCTION-HARDENED)
// ============================================================

/**
 * Process a single user - check if rescue needed and prepare execution
 * 
 * PRODUCTION SAFETY INVARIANTS ENFORCED:
 * 1. User must have rescue.enabled=true in ENS
 * 2. Chain must be in allowedChains
 * 3. Policy must pass validation
 * 4. Position must actually need rescue (HF < minHF)
 * 5. Supply calculation must be positive
 * 6. CRITICAL: Rescue must restore HF >= minHF (no partial unsafe rescues)
 * 7. Token must be a supported stablecoin
 * 8. Quote must target trusted LI.FI router
 * 
 * Returns null if user should be skipped (with reason logged).
 * Returns RescueResult on execution attempt.
 */
async function processUser(
  user: MonitoredUser,
  ctx: TickContext
): Promise<{ result: RescueResult | null; skipReason?: SkipReason }> {
  const { address: userAddress, ensName } = user;
  const { chainConfig, provider, mainnetProvider, signer, executorAddress, demoMode } = ctx;
  const userLog = userAddress.slice(0, 10) + '...';

  logger.keeper.info('Processing user', { user: userLog, ens: ensName });

  // ============================================================
  // STEP 1: Read ENS policy (always from mainnet)
  // ============================================================
  const rawConfig = await readEnsConfig(ensName, mainnetProvider);
  
  // Parse config - ALWAYS falls back to DEFAULT_POLICY if ENS missing
  // If RESCUE_FORCE_ENABLE=true, rescue will be enabled with loud warnings
  const policy = parseEnsConfig(rawConfig, demoMode);
  
  // Log what policy source we're using
  const hasEnsConfig = rawConfig && Object.keys(rawConfig).length > 0;
  if (!hasEnsConfig) {
    if (policy.enabled) {
      // Force-enable override is active (logged in parser)
      logger.keeper.warn('Rescue enabled via  override', { 
        ens: ensName || 'no_ens_name',
        enabled: policy.enabled,
        warning: 'This should NEVER be used in production without user consent',
      });
    } else {
      logger.keeper.info('Using DEFAULT_POLICY (no ENS config found)', { 
        ens: ensName || 'no_ens_name',
        enabled: policy.enabled,
        note: 'Rescue requires rescue.enabled=true via ENS or RESCUE_FORCE_ENABLE=true',
      });
    }
  }

  // ============================================================
  // STEP 2: Read Aave position FIRST for observability
  // We show user's health status regardless of whether rescue is enabled
  // ============================================================
  const accountData = await getUserAccountData(chainConfig.aavePool, userAddress, provider);
  if (!accountData) {
    logger.keeper.error('Failed to read Aave data, skipping', { user: userLog });
    return { result: null, skipReason: 'aave_data_unavailable' };
  }

  // Always log user's health status for observability
  const hfDisplay = accountData.healthFactor.toFixed(4);
  const collateralUSD = accountData.totalCollateralUSD.toFixed(2);
  const debtUSD = accountData.totalDebtUSD.toFixed(2);
  const riskLevel = getRiskLevel(accountData.healthFactor);

  logger.keeper.info('User health status', {
    user: userLog,
    ens: ensName,
    healthFactor: hfDisplay,
    collateralUSD: `$${collateralUSD}`,
    debtUSD: `$${debtUSD}`,
    riskLevel,
  });

  // ============================================================
  // STEP 3: CRITICAL - Check explicit user consent
  // ============================================================
  if (!policy.enabled) {
    logger.keeper.info('Rescue not enabled by user, skipping', { 
      ens: ensName,
      reason: 'User must set rescue.enabled=true in ENS',
    });
    return { result: null, skipReason: 'rescue_not_enabled' };
  }

  // ============================================================
  // STEP 4: Validate policy integrity
  // ============================================================
  const policyErrors = validatePolicy(policy);
  // Filter out the "not enabled" error since we already checked
  const realErrors = policyErrors.filter(e => !e.includes('not enabled'));
  
  if (realErrors.length > 0) {
    logger.keeper.warn('Policy validation failed, skipping', {
      ens: ensName,
      errors: realErrors,
    });
    return { result: null, skipReason: 'policy_validation_failed' };
  }

  // ============================================================
  // STEP 5: Check if chain is allowed by policy
  // ============================================================
  if (!isChainAllowed(chainConfig.chainId, policy)) {
    logger.keeper.debug('Chain not allowed by policy, skipping', {
      chainId: chainConfig.chainId,
      allowed: policy.allowedChains,
    });
    return { result: null, skipReason: 'chain_not_allowed' };
  }

  // ============================================================
  // STEP 6: Check cooldown (INFORMATIONAL ONLY)
  // The on-chain contract is the source of truth for cooldown.
  // We check here only to avoid wasting gas on transactions that will revert.
  // ============================================================
  const cooldownInfo = await checkCooldownInfo(
    executorAddress,
    userAddress,
    policy.cooldownSeconds,
    signer
  );
  
  if (!cooldownInfo.passed) {
    logger.keeper.debug('Cooldown likely active (informational), will attempt anyway', { 
      user: userLog,
      remainingSeconds: cooldownInfo.remainingSeconds,
      note: 'Contract is source of truth - may still succeed',
    });
    // DO NOT skip - let contract enforce cooldown
  }

  // ============================================================
  // STEP 7: Check if rescue needed
  // ============================================================
  if (!needsRescue(accountData, policy.minHF)) {
    logger.keeper.debug('Position healthy, no rescue needed', {
      user: userLog,
      hf: hfDisplay,
      minHF: policy.minHF,
    });
    return { result: null, skipReason: 'position_healthy' };
  }

  logger.keeper.info('Rescue needed', {
    user: userLog,
    hf: accountData.healthFactor.toFixed(4),
    minHF: policy.minHF,
    risk: getRiskLevel(accountData.healthFactor),
  });

  // ============================================================
  // STEP 8: Compute required supply with safety checks
  // ============================================================
  const supplyCalc = computeRequiredSupply(accountData, policy);
  
  if (supplyCalc.amountUSD <= 0) {
    logger.keeper.debug('No supply needed', { reason: supplyCalc.reason });
    return { result: null, skipReason: 'no_supply_needed' };
  }

  // ============================================================
  // STEP 9: CRITICAL - Reject if rescue won't restore health
  // This prevents infinite rescue loops from capped partial rescues
  // ============================================================
  if (!supplyCalc.willRestoreHealth) {
    logger.keeper.warn('RESCUE REJECTED: Would not restore health factor', {
      user: userLog,
      currentHF: accountData.healthFactor.toFixed(4),
      expectedHF: supplyCalc.expectedHF.toFixed(4),
      minHF: policy.minHF,
      amountUSD: supplyCalc.amountUSD.toFixed(2),
      maxAmountUSD: policy.maxAmountUSD,
      reason: 'Capped rescue would leave user below minHF - user needs to increase maxAmountUSD',
    });
    return { result: null, skipReason: 'insufficient_cap_for_safety' };
  }

  logger.keeper.info('Supply calculation approved', {
    user: userLog,
    amountUSD: supplyCalc.amountUSD.toFixed(2),
    expectedHF: supplyCalc.expectedHF.toFixed(4),
    reason: supplyCalc.reason,
  });

  // ============================================================
  // STEP 10: Select stablecoin from policy
  // ============================================================
  const supplyToken = selectStablecoinFromPolicy(policy.allowedTokens, chainConfig.chainId);
  if (!supplyToken) {
    logger.keeper.error('No valid stablecoin available on chain', {
      allowedTokens: policy.allowedTokens,
      chainId: chainConfig.chainId,
    });
    return { result: null, skipReason: 'no_valid_stablecoin' };
  }

  const tokenAddress = getTokenAddress(chainConfig.chainId, supplyToken.symbol);
  if (!tokenAddress) {
    logger.keeper.error('Token address not found', {
      token: supplyToken.symbol,
      chainId: chainConfig.chainId,
    });
    return { result: null, skipReason: 'token_address_not_found' };
  }

  logger.keeper.info('Selected stablecoin for rescue', {
    symbol: supplyToken.symbol,
    decimals: supplyToken.decimals,
    address: tokenAddress.slice(0, 10) + '...',
  });

  // ============================================================
  // STEP 11: Convert USD to token units
  // ASSUMPTION: Stablecoin price = $1.00 (validated by only allowing stablecoins)
  // ============================================================
  const STABLECOIN_PRICE = 1.0; // Valid assumption for USDC, USDT, DAI, etc.
  const tokenAmount = usdToTokenUnits(supplyCalc.amountUSD, STABLECOIN_PRICE, supplyToken.decimals);

  logger.keeper.debug('Token amount calculated', {
    usdAmount: supplyCalc.amountUSD.toFixed(2),
    tokenAmount: tokenAmount.toString(),
    decimals: supplyToken.decimals,
    priceAssumption: '$1.00 (stablecoin)',
  });

  // ============================================================
  // STEP 12: Get LI.FI quote
  // ============================================================
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
    logger.keeper.error('Failed to get LI.FI quote', { user: userLog });
    return { result: null, skipReason: 'quote_failed' };
  }

  // ============================================================
  // STEP 13: Validate quote target is trusted LI.FI contract for this chain
  // SECURITY CRITICAL: We use a chain-aware allowlist, not single router
  // ============================================================
  if (!isTrustedLiFiTarget(chainConfig.chainId, quote.to)) {
    const trustedTargets = getTrustedLiFiTargets(chainConfig.chainId);
    logger.keeper.error('Quote target not in trusted LI.FI allowlist - SECURITY ISSUE', {
      chainId: chainConfig.chainId,
      chainName: chainConfig.name,
      receivedTarget: quote.to,
      trustedTargets: trustedTargets,
      action: 'ABORT - will not execute calldata to untrusted contract',
    });
    return { result: null, skipReason: 'quote_target_invalid' };
  }

  logger.keeper.debug('LI.FI quote target validated', {
    target: quote.to,
    chainId: chainConfig.chainId,
  });

  // ============================================================
  // STEP 14: Execute rescue
  // ============================================================
  logger.keeper.info('Executing rescue transaction', {
    user: userLog,
    token: supplyToken.symbol,
    amountUSD: supplyCalc.amountUSD.toFixed(2),
    expectedHF: supplyCalc.expectedHF.toFixed(4),
  });

  const executeParams: ExecuteParams = {
    userAddress,
    tokenIn: tokenAddress,
    amountIn: tokenAmount,
    quote,
    amountUSD: supplyCalc.amountUSD,
  };

  const result = await executeRescue(executorAddress, executeParams, signer);
  return { result };
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
 * PRODUCTION BEHAVIOR:
 * - Each user is processed independently
 * - Failures for one user don't affect others
 * - Skip reasons are tracked for diagnostics
 * - Rescue loops are prevented by rejecting unsafe partial rescues
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
    usersSkipped: 0,
    errors: new Map(),
    skipReasons: new Map(),
  };

  // Handle empty user list (log warning but don't throw)
  if (monitoredUsers.length === 0) {
    logger.keeper.warn('No users configured to monitor - tick is a no-op');
    return result;
  }

  logger.keeper.info('Starting monitoring cycle', { 
    users: monitoredUsers.length,
    chain: ctx.chainConfig.name,
    demoMode: ctx.demoMode,
  });

  for (const user of monitoredUsers) {
    result.usersProcessed++;

    try {
      const { result: rescueResult, skipReason } = await processUser(user, ctx);

      if (skipReason) {
        result.usersSkipped++;
        result.skipReasons.set(user.address, skipReason);
        logger.keeper.debug('User skipped', {
          user: user.address.slice(0, 10) + '...',
          reason: skipReason,
        });
        continue;
      }

      if (rescueResult) {
        result.rescuesAttempted++;
        
        if (rescueResult.success) {
          result.rescuesSucceeded++;
          logger.keeper.info('Rescue successful', {
            user: user.address.slice(0, 10) + '...',
            txHash: rescueResult.txHash,
            amountUSD: rescueResult.amountUSD.toFixed(2),
          });
        } else {
          // Rescue attempted but failed
          const errorMsg = rescueResult.error || 'Unknown error';
          result.errors.set(user.address, errorMsg);
          logger.keeper.error('Rescue failed', {
            user: user.address.slice(0, 10) + '...',
            error: errorMsg,
          });
        }
      }
      // If rescueResult is null and no skipReason, user was processed but nothing needed
      
    } catch (error) {
      // Catch any unexpected errors - log and continue to next user
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.set(user.address, errorMsg);
      logger.keeper.error('Error processing user', {
        user: user.address.slice(0, 10) + '...',
        error: errorMsg,
      });
      // DO NOT re-throw - continue to next user
    }
  }

  // Log cycle summary
  logger.keeper.info('Monitoring cycle complete', {
    processed: result.usersProcessed,
    skipped: result.usersSkipped,
    attempted: result.rescuesAttempted,
    succeeded: result.rescuesSucceeded,
    errors: result.errors.size,
  });

  // Log skip reasons summary if any
  if (result.skipReasons.size > 0) {
    const reasonCounts: Record<string, number> = {};
    for (const reason of result.skipReasons.values()) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
    logger.keeper.debug('Skip reasons summary', reasonCounts);
  }

  return result;
}
