/**
 * Keeper Runner - Infinite Loop with Precise Timing
 * 
 * ============================================================
 * WHAT THIS MODULE DOES:
 * ============================================================
 * - Runs the keeper FOREVER (until fatal error or SIGINT)
 * - Calls tick() every POLL_INTERVAL_MS
 * - Ensures NO overlapping executions
 * - Handles timing precisely (subtracts execution time from sleep)
 * 
 * ============================================================
 * WHAT THIS MODULE DOES NOT DO:
 * ============================================================
 * - Does NOT contain business logic
 * - Does NOT use setInterval (uses while loop for precise control)
 * - Does NOT modify ENS/Aave/LI.FI logic
 * 
 * ============================================================
 * TIMING GUARANTEE:
 * ============================================================
 * Using a while loop with calculated sleep ensures:
 * - No drift over time
 * - No overlapping executions
 * - Precise interval even if tick() takes variable time
 * ============================================================
 */

import { tick, type TickContext, type TickResult } from './tick.js';
import { logger } from '../utils/logger.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Runner configuration
 */
export interface RunnerConfig {
  /** Polling interval in milliseconds */
  pollIntervalMs: number;
  /** Tick context (providers, signer, users, etc.) */
  tickContext: TickContext;
}

/**
 * Runner statistics
 */
interface RunnerStats {
  /** Total ticks executed */
  totalTicks: number;
  /** Total rescues succeeded */
  totalRescues: number;
  /** Total errors encountered */
  totalErrors: number;
  /** Total users skipped */
  totalSkipped: number;
  /** Time runner started */
  startedAt: Date;
}

// ============================================================
// SLEEP UTILITY
// ============================================================

/**
 * Sleep for a given number of milliseconds
 * 
 * @param ms - Milliseconds to sleep (will clamp to 0 if negative)
 */
function sleep(ms: number): Promise<void> {
  // Clamp to 0 if negative (tick took longer than interval)
  const sleepTime = Math.max(0, ms);
  return new Promise((resolve) => setTimeout(resolve, sleepTime));
}

// ============================================================
// SHUTDOWN HANDLING
// ============================================================

/** Flag to signal graceful shutdown */
let shutdownRequested = false;

/**
 * Request graceful shutdown
 * 
 * Called by signal handlers. The runner will complete the current
 * tick and then exit cleanly.
 */
export function requestShutdown(): void {
  shutdownRequested = true;
  logger.keeper.info('Shutdown requested - will exit after current tick');
}

/**
 * Check if shutdown was requested
 */
export function isShutdownRequested(): boolean {
  return shutdownRequested;
}

// ============================================================
// RUNNER
// ============================================================

/**
 * Run the keeper loop forever
 * 
 * This function runs until:
 * - A fatal error occurs (thrown upward)
 * - Shutdown is requested via requestShutdown()
 * - Process receives SIGINT/SIGTERM
 * 
 * The loop guarantees:
 * - No overlapping executions (sequential await)
 * - Precise timing (sleep = interval - elapsed)
 * - Resilient to tick errors (logged, not thrown)
 * 
 * @param config - Runner configuration
 */
export async function runForever(config: RunnerConfig): Promise<void> {
  const { pollIntervalMs, tickContext } = config;

  // Initialize stats
  const stats: RunnerStats = {
    totalTicks: 0,
    totalRescues: 0,
    totalErrors: 0,
    totalSkipped: 0,
    startedAt: new Date(),
  };

  logger.keeper.info('Runner started', {
    pollIntervalMs,
    users: tickContext.monitoredUsers.length,
    chain: tickContext.chainConfig.name,
  });

  // Register signal handlers for graceful shutdown
  const handleSignal = (signal: string) => {
    logger.keeper.info(`Received ${signal}`);
    requestShutdown();
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // ============================================================
  // MAIN LOOP - while(true) with precise timing
  // ============================================================
  while (!shutdownRequested) {
    const tickStart = Date.now();

    try {
      // Execute one tick
      const result: TickResult = await tick(tickContext);
      
      // Update stats
      stats.totalTicks++;
      stats.totalRescues += result.rescuesSucceeded;
      stats.totalErrors += result.errors.size;
      stats.totalSkipped += result.usersSkipped;

      // Log periodic stats (every 10 ticks)
      if (stats.totalTicks % 10 === 0) {
        const uptimeMs = Date.now() - stats.startedAt.getTime();
        const uptimeHours = (uptimeMs / (1000 * 60 * 60)).toFixed(2);
        logger.keeper.info('Runner stats', {
          ticks: stats.totalTicks,
          rescues: stats.totalRescues,
          errors: stats.totalErrors,
          skipped: stats.totalSkipped,
          uptimeHours,
        });
      }

    } catch (error) {
      // Unexpected error in tick - log and continue
      // This should be rare since tick() catches user-level errors
      stats.totalErrors++;
      logger.keeper.error('Unexpected tick error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tick: stats.totalTicks,
      });
      // DO NOT re-throw - continue running
    }

    // Calculate sleep time (interval - elapsed)
    const elapsed = Date.now() - tickStart;
    const sleepTime = pollIntervalMs - elapsed;

    if (sleepTime < 0) {
      logger.keeper.warn('Tick took longer than poll interval', {
        elapsed,
        interval: pollIntervalMs,
        overtime: -sleepTime,
      });
    }

    // Sleep until next tick (or 0 if we're behind)
    if (!shutdownRequested) {
      await sleep(sleepTime);
    }
  }

  // ============================================================
  // GRACEFUL SHUTDOWN
  // ============================================================
  const uptimeMs = Date.now() - stats.startedAt.getTime();
  const uptimeMinutes = (uptimeMs / (1000 * 60)).toFixed(2);

  logger.keeper.info('Runner stopped gracefully', {
    totalTicks: stats.totalTicks,
    totalRescues: stats.totalRescues,
    totalErrors: stats.totalErrors,
    uptimeMinutes,
  });
}
