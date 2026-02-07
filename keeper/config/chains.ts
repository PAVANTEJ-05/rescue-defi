/**
 * Blockchain network configuration for Rescue.ETH
 * 
 * Defines supported chains and their contract addresses.
 * All addresses are for Aave V3 deployments.
 * 
 * ============================================================
 * LI.FI TRUSTED TARGETS
 * ============================================================
 * LI.FI uses multiple execution contracts depending on the route.
 * We maintain a registry of trusted targets per chain for security.
 * 
 * Known LI.FI contracts (from https://docs.li.fi/integrate-li.fi-sdk/deployments):
 * - LiFiDiamond: 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE (all chains)
 * - LiFiDiamondImmutable: 0x9b11bc9FAc17c058CAB6286b0c785bE6a65492EF (some chains)
 * - Receiver/Executor contracts vary by chain
 * ============================================================
 */

/**
 * Chain configuration with all required addresses
 */
export interface ChainConfig {
  /** Unique chain identifier */
  chainId: number;
  /** Human-readable name */
  name: string;
  /** Native token symbol */
  nativeToken: string;
  /** Default RPC URL (can be overridden via env) */
  rpcUrl: string;
  /** Aave V3 Pool address */
  aavePool: string;
  /** Aave V3 Pool Data Provider (for detailed reserve data) */
  aavePoolDataProvider: string;
  /** LI.FI Diamond (router) address - primary router */
  lifiRouter: string;
  /** Block explorer URL */
  explorer: string;
}

/**
 * Chain IDs as constants
 */
export const CHAIN_IDS = {
  MAINNET: 1,
  OPTIMISM: 10,
  ARBITRUM: 42161,
  BASE: 8453,
} as const;

/**
 * Trusted LI.FI execution targets per chain
 * 
 * SECURITY CRITICAL: Only addresses in this registry are allowed as quote targets.
 * Adding addresses here requires security review.
 * 
 * Sources:
 * - https://docs.li.fi/integrate-li.fi-sdk/deployments
 * - LI.FI contract verification on block explorers
 * 
 * Known contracts:
 * - LiFiDiamond (primary router): 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE
 * - LiFiDiamondImmutable: 0x9b11bc9FAc17c058CAB6286b0c785bE6a65492EF
 * - RelayerCelerIM (Optimism): 0x6a8b11bF29C0546991DEa5569bf3b3C8C4f38d54
 * - Executor: Chain-specific execution contracts
 * - GasZipFacet: 0xBfA69CdE0191C59758E483A76A07939C53C177Ab (Optimism, for gas payments)
 */
export const TRUSTED_LIFI_TARGETS: Record<number, Set<string>> = {
  [CHAIN_IDS.MAINNET]: new Set([
    '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // LiFiDiamond
    '0x9b11bc9FAc17c058CAB6286b0c785bE6a65492EF', // LiFiDiamondImmutable
  ].map(addr => addr.toLowerCase())),
  
  [CHAIN_IDS.OPTIMISM]: new Set([
    '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // LiFiDiamond
    '0x9b11bc9FAc17c058CAB6286b0c785bE6a65492EF', // LiFiDiamondImmutable
    '0x6a8b11bF29C0546991DEa5569bf3b3C8C4f38d54', // RelayerCelerIM
    '0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9', // Executor
    '0xBfA69CdE0191C59758E483A76A07939C53C177Ab', // GasZipFacet / Receiver
    '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', // LiFiDiamond (lowercase for safety)
  ].map(addr => addr.toLowerCase())),
  
  [CHAIN_IDS.ARBITRUM]: new Set([
    '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // LiFiDiamond
    '0x9b11bc9FAc17c058CAB6286b0c785bE6a65492EF', // LiFiDiamondImmutable
  ].map(addr => addr.toLowerCase())),
  
  [CHAIN_IDS.BASE]: new Set([
    '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // LiFiDiamond
    '0x9b11bc9FAc17c058CAB6286b0c785bE6a65492EF', // LiFiDiamondImmutable
  ].map(addr => addr.toLowerCase())),
};

/**
 * Check if an address is a trusted LI.FI target for a given chain
 * 
 * @param chainId - The chain ID to check
 * @param target - The target address from the LI.FI quote
 * @returns True if the target is trusted for the chain
 */
export function isTrustedLiFiTarget(chainId: number, target: string): boolean {
  const trustedSet = TRUSTED_LIFI_TARGETS[chainId];
  if (!trustedSet) {
    return false;
  }
  return trustedSet.has(target.toLowerCase());
}

/**
 * Get all trusted LI.FI targets for a chain (for logging)
 * 
 * @param chainId - The chain ID
 * @returns Array of trusted addresses or empty array
 */
export function getTrustedLiFiTargets(chainId: number): string[] {
  const trustedSet = TRUSTED_LIFI_TARGETS[chainId];
  if (!trustedSet) {
    return [];
  }
  return Array.from(trustedSet);
}

/**
 * Supported chains with full configuration
 * 
 * Addresses sourced from:
 * - Aave: https://docs.aave.com/developers/deployed-contracts/v3-mainnet
 * - LI.FI: https://docs.li.fi/integrate-li.fi-sdk/deployments
 */
export const CHAINS: Record<number, ChainConfig> = {
  [CHAIN_IDS.MAINNET]: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    nativeToken: 'ETH',
    rpcUrl: 'https://eth.llamarpc.com',
    aavePool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    aavePoolDataProvider: '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3',
    lifiRouter: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
    explorer: 'https://etherscan.io',
  },
  [CHAIN_IDS.OPTIMISM]: {
    chainId: 10,
    name: 'Optimism',
    nativeToken: 'ETH',
    rpcUrl: 'https://mainnet.optimism.io',
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    aavePoolDataProvider: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    lifiRouter: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
    explorer: 'https://optimistic.etherscan.io',
  },
  [CHAIN_IDS.ARBITRUM]: {
    chainId: 42161,
    name: 'Arbitrum One',
    nativeToken: 'ETH',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    aavePoolDataProvider: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    lifiRouter: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
    explorer: 'https://arbiscan.io',
  },
  [CHAIN_IDS.BASE]: {
    chainId: 8453,
    name: 'Base',
    nativeToken: 'ETH',
    rpcUrl: 'https://mainnet.base.org',
    aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    aavePoolDataProvider: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac',
    lifiRouter: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
    explorer: 'https://basescan.org',
  },
} as const;

/**
 * Common token addresses by chain
 * Used for resolving token symbols to addresses
 */
export const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  [CHAIN_IDS.MAINNET]: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeBC5D44d93dD', // Correct mainnet DAI
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    ETH: '0x0000000000000000000000000000000000000000',
  },
  [CHAIN_IDS.OPTIMISM]: {
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WETH: '0x4200000000000000000000000000000000000006',
    ETH: '0x0000000000000000000000000000000000000000',
  },
  [CHAIN_IDS.BASE]: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    WETH: '0x4200000000000000000000000000000000000006',
    ETH: '0x0000000000000000000000000000000000000000',
  },
  [CHAIN_IDS.ARBITRUM]: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    ETH: '0x0000000000000000000000000000000000000000',
  },
} as const;

/**
 * Get chain config by ID
 * @throws Error if chain is not supported
 */
export function getChainConfig(chainId: number): ChainConfig {
  const config = CHAINS[chainId];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  return config;
}

/**
 * Get token address for a symbol on a specific chain
 * @returns Token address or undefined if not found
 */
export function getTokenAddress(chainId: number, symbol: string): string | undefined {
  return TOKEN_ADDRESSES[chainId]?.[symbol.toUpperCase()];
}

/**
 * Check if a chain is supported
 */
export function isChainSupported(chainId: number): boolean {
  return chainId in CHAINS;
}
