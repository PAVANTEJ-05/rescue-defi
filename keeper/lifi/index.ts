/**
 * LI.FI Module Exports for Rescue.ETH
 * 
 * ============================================================
 * MODULE STRUCTURE
 * ============================================================
 * 
 * This module provides LI.FI integration for cross-chain rescue operations.
 * 
 * types.ts    - Type definitions for LI.FI integration
 * quote.ts    - contractCallsQuote API (bridge + Aave supply)
 * execute.ts  - Transaction execution via RescueExecutor contract
 * 
 * ============================================================
 * USAGE
 * ============================================================
 * 
 * For keeper integration:
 *   import { getQuote, isValidQuoteTarget } from './lifi/quote.js';
 *   import { executeRescue, checkCooldownInfo } from './lifi/execute.js';
 * 
 * ============================================================
 * IMPORTANT NOTES
 * ============================================================
 * 
 * - Uses contractCallsQuote, NOT standard getRoutes/getQuote
 * - contractCallsQuote allows executing Aave.supply() after bridge
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
  ContractCall,
  ContractCallsQuoteRequest,
  LiFiTransactionRequest,
  LiFiQuoteResponse,
  ExecuteParams,
} from './types.js';

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
  // ABI
  AAVE_POOL_ABI,
} from './quote.js';

export type { QuoteParams, GetQuoteParams } from './quote.js';

// ============================================================
// EXECUTE EXPORTS
// ============================================================

export {
  executeRescue,
  checkCooldownInfo,
  isCooldownPassed,
} from './execute.js';

export type { CooldownInfo } from './execute.js';

// ============================================================
// CROSS-CHAIN RESCUE EXPORTS (from execute.ts integration)
// ============================================================

export {
  getCrossChainQuote,
  loadCrossChainConfig,
} from './crosschain-rescue.js';

export type {
  CrossChainConfig,
  CrossChainQuoteParams,
} from './crosschain-rescue.js';