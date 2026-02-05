/**
 * Blockchain network configuration for Rescue.ETH
 * 
 * Defines supported chains and their contract addresses.
 * All addresses are for Aave V3 deployments.
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
  /** LI.FI Diamond (router) address */
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
    aavePoolDataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
    lifiRouter: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
    explorer: 'https://optimistic.etherscan.io',
  },
  [CHAIN_IDS.ARBITRUM]: {
    chainId: 42161,
    name: 'Arbitrum One',
    nativeToken: 'ETH',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    aavePoolDataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
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
