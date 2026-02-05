/**
 * Logging utilities for Rescue.ETH keeper
 * 
 * Structured logging with consistent format for debugging and monitoring.
 * No external dependencies - uses console with formatting.
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
  [key: string]: unknown;
}

/**
 * Current log level (can be set via environment)
 */
const LOG_LEVEL: LogLevel = (process.env['LOG_LEVEL'] as LogLevel) || 'INFO';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Check if a message should be logged based on current level
 */
function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[LOG_LEVEL];
}

/**
 * Format timestamp for log output
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Format context object for display
 */
function formatContext(ctx: LogContext): string {
  if (Object.keys(ctx).length === 0) return '';
  return ' ' + JSON.stringify(ctx);
}

/**
 * Core logging function
 */
function log(level: LogLevel, module: string, message: string, ctx: LogContext = {}): void {
  if (!shouldLog(level)) return;

  const prefix = `[${timestamp()}] [${level}] [${module}]`;
  const contextStr = formatContext(ctx);
  
  const output = `${prefix} ${message}${contextStr}`;

  switch (level) {
    case 'ERROR':
      console.error(output);
      break;
    case 'WARN':
      console.warn(output);
      break;
    default:
      console.log(output);
  }
}

/**
 * Create a logger instance for a specific module
 */
export function createLogger(module: string) {
  return {
    debug: (message: string, ctx?: LogContext) => log('DEBUG', module, message, ctx),
    info: (message: string, ctx?: LogContext) => log('INFO', module, message, ctx),
    warn: (message: string, ctx?: LogContext) => log('WARN', module, message, ctx),
    error: (message: string, ctx?: LogContext) => log('ERROR', module, message, ctx),
  };
}

/**
 * Pre-configured loggers for each module
 */
export const logger = {
  keeper: createLogger('Keeper'),
  aave: createLogger('Aave'),
  ens: createLogger('ENS'),
  lifi: createLogger('LiFi'),
  executor: createLogger('Executor'),
};
