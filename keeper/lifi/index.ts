/**
 * LI.FI Module Exports for Rescue.ETH
 * 
 * ============================================================
 * MODULE STRUCTURE
 * ============================================================
 * 
 * This module provides LI.FI integration for cross-chain rescue operations.
 * It is structured as follows:
 * 
 * types.ts    - Type definitions for LI.FI integration
 * config.ts   - SDK configuration and client factories
 * quote.ts    - contractCallsQuote API (bridge + Aave supply)
 * execute.ts  - Transaction submission and cooldown tracking
 * simulate.ts - Bridge simulation for fork/demo environments
 * demo.ts     - Runnable demo script (preserved original logic)
 * 
 * ============================================================
 * USAGE
 * ============================================================
 * 
 * For keeper integration:
 *   import { getQuote, isValidQuoteTarget } from './lifi/quote.js';
 *   import { executeRescue, isCooldownPassed } from './lifi/execute.js';
 * 
 * For running the demo:
 *   cd keeper && npx tsx lifi/demo.ts
 * 
 * ============================================================
 * IMPORTANT NOTES
 * ============================================================
 * 
 * - Uses contractCallsQuote, NOT standard getRoutes/getQuote
 * - contractCallsQuote allows executing Aave.supply() after bridge
 * - Fork environments require bridge simulation (see simulate.ts)
 * - Production deployments use real bridges (no simulation needed)
 * 
 * DO NOT modify the quote logic or replace contractCallsQuote.
 * See quote.ts for detailed explanation of why this API is required.
 * ============================================================
 */

// ============================================================
// TYPE EXPORTS
// ============================================================

export type {
  SupportedChain,
  TokenInfo,
  TokensByChain,
  ContractCall,
  ContractCallsQuoteRequest,
  LiFiTransactionRequest,
  LiFiQuoteResponse,
  ExecuteParams,
  BridgeSimulationParams,
} from './types.js';

// ============================================================
// CONFIG EXPORTS
// ============================================================

export {
  // Client factories
  getWalletClientForChain,
  getPublicClientForChain,
  createAnvilTestClient,
  // Pre-configured clients
  mainnetTestClient,
  baseTestClient,
  mainnetWalletClient,
  mainnetPublicClient,
  // SDK initialization
  initializeLiFiConfig,
  // Constants
  ChainId,
  SUPPORTED_CHAINS,
  LOCAL_FORK_URL,
  TENDERLY_BASE_URL,
} from './config.js';

// ============================================================
// QUOTE EXPORTS
// ============================================================

export {
  // Quote functions
  getQuote,
  fetchContractCallsQuote,
  buildContractCallsQuoteRequest,
  isValidQuoteTarget,
  // Calldata encoding
  encodeAaveSupplyCalldata,
  // Constants
  USDC_BASE_ADDRESS,
  AAVE_POOL_ADDRESS,
  AAVE_POOL_ABI,
} from './quote.js';

export type { QuoteParams, GetQuoteParams } from './quote.js';

// ============================================================
// EXECUTE EXPORTS
// ============================================================

export {
  executeTransaction,
  executeRescue,
  executeRouteStep,
  isCooldownPassed,
} from './execute.js';

// ============================================================
// SIMULATE EXPORTS
// ============================================================

export {
  // Simulation functions
  simulateBridgeArrival,
  simulateStepBridgeArrival,
  simulateUsdcBridgeArrival,
  fundWithNativeToken,
  // Balance utilities
  checkTokenBalance,
  formatTokenAmount,
  // Constants
  TOKEN_HOLDERS,
  TOKEN_ADDRESSES,
} from './simulate.js';