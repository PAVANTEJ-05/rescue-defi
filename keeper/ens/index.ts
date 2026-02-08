/**
 * ENS Module Exports for Rescue.ETH
 * 
 * ============================================================
 * MODULE STRUCTURE
 * ============================================================
 * 
 * This module provides ENS integration for reading rescue configuration.
 * Configuration is stored as text records on user's ENS names.
 * 
 * reader.ts  - Read ENS text records (rescue.* keys)
 * parser.ts  - Parse strings into typed RescuePolicy
 * writer.ts  - Write ENS records (demo/testing only)
 * demo.ts    - Runnable demo script (preserved original logic)
 * 
 * ============================================================
 * ENS RECORD KEYS
 * ============================================================
 * 
 * Users configure rescue behavior via these ENS text records:
 * 
 * - rescue.minHF        → Minimum HF to trigger rescue (e.g., "1.2")
 * - rescue.targetHF     → Target HF after rescue (e.g., "1.5")
 * - rescue.maxAmount    → Max USD per rescue (e.g., "100")
 * - rescue.cooldown     → Seconds between rescues (e.g., "3600")
 * - rescue.allowedTokens → Allowed tokens (e.g., "USDC,ETH,DAI")
 * - rescue.allowedChains → Allowed chains (e.g., "1,10,8453")
 * 
 * ============================================================
 * USAGE
 * ============================================================
 * 
 * For keeper integration:
 *   import { readEnsConfig } from './ens/reader.js';
 *   import { parseEnsConfig, isChainAllowed } from './ens/parser.js';
 * 
 * For running the demo:
 *   cd keeper && npx tsx ens/demo.ts
 * 
 * ============================================================
 * IMPORTANT NOTES
 * ============================================================
 * 
 * - ENS is only on mainnet (reads always go to mainnet/fork)
 * - Writing records requires owning the ENS name
 * - Demo uses impersonation (fork only)
 * - Production: users set records via app.ens.domains
 * ============================================================
 */

// ============================================================
// READER EXPORTS
// ============================================================

export {
  // Reading functions
  readEnsConfig,
  readAllEnsConfig,
  readEnsText,
  hasRescueConfig,
  resolveEnsAddress,
  // Client creation
  createEnsPublicClient,
  // Constants
  ENS_KEYS,
  ALL_ENS_KEYS,
} from './reader.js';

export type { RawEnsConfig } from './reader.js';

// ============================================================
// PARSER EXPORTS
// ============================================================

export {
  // Parsing
  parseEnsConfig,
  // Validation
  isChainAllowed,
  isTokenAllowed,
  validatePolicy,
  // Formatting
  formatPolicy,
} from './parser.js';

// ============================================================
// WRITER EXPORTS — Moved to sandbox/ens-writer.ts
// For demo/fork usage: import from '../sandbox/ens-writer.js'
// ============================================================

