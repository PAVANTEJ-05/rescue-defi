/**
 * Supported blockchain networks for Rescue.ETH
 *
 * We start with L2s (Optimism, Base) for lower gas costs.
 * Mainnet support can be added later.
 */

export interface ChainConfig {
  /** Unique chain identifier */
  chainId: number;
  /** Human-readable chain name */
  name: string;
  /** Native gas token symbol */
  nativeToken: string;
}

/**
 * Chain IDs as constants for type-safe lookups
 */
export const CHAIN_IDS = {
  OPTIMISM: 10,
  BASE: 8453,
} as const;

/**
 * Supported chains metadata
 * Used for display, logging, and chain-specific branching
 */
export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  [CHAIN_IDS.OPTIMISM]: {
    chainId: CHAIN_IDS.OPTIMISM,
    name: "Optimism",
    nativeToken: "ETH",
  },
  [CHAIN_IDS.BASE]: {
    chainId: CHAIN_IDS.BASE,
    name: "Base",
    nativeToken: "ETH",
  },
} as const;

/**
 * List of supported chain IDs for iteration
 */
export const SUPPORTED_CHAIN_IDS = Object.keys(SUPPORTED_CHAINS).map(Number);
