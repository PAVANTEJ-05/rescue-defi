/**
 * LI.FI SDK Configuration for Rescue.ETH
 * 
 * ============================================================
 * DEMO-ONLY / FORK ENVIRONMENT
 * ============================================================
 * This configuration is designed for LOCAL FORKS and Tenderly virtual testnets.
 * 
 * WHY FORKS:
 * - Allows testing without real funds
 * - Impersonation of whale accounts for liquidity
 * - Deterministic testing environment
 * 
 * WHY TENDERLY (for Base):
 * - Provides virtual testnet with state manipulation
 * - Allows simulation of bridge arrivals
 * - Supports cheatcodes (setBalance, impersonation)
 * 
 * PRODUCTION DIFFERENCES:
 * - Use real RPC endpoints (Alchemy, Infura)
 * - Remove impersonation logic
 * - Real bridges will relay transactions automatically
 * - No manual bridge simulation needed
 * ============================================================
 */

import {
  createConfig,
  ChainId,
  EVM,
} from '@lifi/sdk';
import {
  createWalletClient,
  createTestClient,
  createPublicClient,
  http,
  publicActions,
  walletActions,
  type Chain,
  type WalletClient,
  type PublicClient,
  type TestClient,
} from 'viem';
import { arbitrum, mainnet, optimism, polygon, base } from 'viem/chains';

// ============================================================
// RPC CONFIGURATION
// ============================================================

/**
 * Local Anvil fork URL (mainnet fork)
 * 
 * Start with: anvil --fork-url <MAINNET_RPC> --port 8546
 */
const LOCAL_FORK_URL = 'http://127.0.0.1:8546';

/**
 * Tenderly Virtual Testnet URL for Base
 * 
 * This allows state manipulation on Base for bridge simulation.
 * In production, this would be a real Base RPC.
 * 
 * TODO: Move to environment variable
 */
const TENDERLY_BASE_URL = 'https://virtual.rpc.tenderly.co/phoenix05/project/private/base-mainnet-lifi-test/44a26a37-95b7-489f-ad45-736c821e6a34';

// ============================================================
// SUPPORTED CHAINS
// ============================================================

/**
 * Chain objects supported by the demo
 * Used for viem client creation
 */
export const SUPPORTED_CHAINS = [arbitrum, mainnet, optimism, polygon, base] as const;

/**
 * Get transport URL for a chain ID
 * 
 * @param chainId - The chain ID
 * @returns HTTP transport URL
 */
function getTransportUrl(chainId: number): string {
  return chainId === ChainId.BAS ? TENDERLY_BASE_URL : LOCAL_FORK_URL;
}

// ============================================================
// CLIENT FACTORIES
// ============================================================

/**
 * Create a wallet client for a specific chain
 * 
 * DEMO NOTE: Uses a hardcoded test address for demo purposes.
 * In production, this would use the actual keeper wallet.
 * 
 * @param chainId - Target chain ID
 * @param account - Account address (optional, defaults to test address)
 * @returns Configured wallet client
 */
export function getWalletClientForChain(
  chainId: number,
  account: `0x${string}` = '0xC3F2F6c9A765c367c33ED11827BB676250481ca7' // Demo test address
): WalletClient {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId) as Chain | undefined;
  const transport = http(getTransportUrl(chainId));

  return createWalletClient({
    account,
    chain: (chain ?? mainnet) as Chain,
    transport,
  });
}

/**
 * Create a public client for a specific chain
 * 
 * @param chainId - Target chain ID
 * @returns Configured public client
 */
export function getPublicClientForChain(chainId: number) {
  const transport = http(getTransportUrl(chainId));
  const chain = chainId === ChainId.BAS ? base : mainnet;

  return createPublicClient({
    chain,
    transport,
  });
}

/**
 * Create a test client for Anvil operations (impersonation, setBalance, etc.)
 * 
 * DEMO-ONLY: Test clients provide cheatcodes for local forks.
 * These do not exist on production networks.
 * 
 * @param chain - Target chain
 * @param rpcUrl - RPC URL (defaults to local fork)
 * @returns Test client with public and wallet actions
 */
export function createAnvilTestClient(
  chain: Chain = mainnet,
  rpcUrl: string = LOCAL_FORK_URL
) {
  return createTestClient({
    chain,
    mode: 'anvil',
    transport: http(rpcUrl),
  })
    .extend(publicActions)
    .extend(walletActions);
}

// ============================================================
// PRE-CONFIGURED CLIENTS
// ============================================================

/**
 * Mainnet test client (local fork)
 * Used for impersonation and state manipulation on mainnet fork
 */
export const mainnetTestClient = createAnvilTestClient(mainnet, LOCAL_FORK_URL);

/**
 * Base test client (Tenderly virtual testnet)
 * Used for bridge simulation - minting tokens that would arrive via bridge
 */
export const baseTestClient = createAnvilTestClient(base, TENDERLY_BASE_URL);

/**
 * Default mainnet clients for common operations
 */
export const mainnetWalletClient = getWalletClientForChain(ChainId.ETH);
export const mainnetPublicClient = getPublicClientForChain(ChainId.ETH);

// ============================================================
// LI.FI SDK INITIALIZATION
// ============================================================

/**
 * Initialize the LI.FI SDK with fork-compatible configuration
 * 
 * IMPORTANT:
 * - preloadChains: false - Prevents SDK from fetching chain data at startup
 * - Custom RPC URLs point to local forks and Tenderly
 * - EVM provider uses our wallet client factory for chain switching
 * 
 * This function must be called before using any LI.FI SDK functions.
 */
export function initializeLiFiConfig(): void {
  createConfig({
    integrator: 'rescue-eth-demo',
    rpcUrls: {
      [ChainId.ETH]: [LOCAL_FORK_URL],
      [ChainId.BAS]: [TENDERLY_BASE_URL],
    },
    providers: [
      EVM({
        getWalletClient: async () => mainnetWalletClient,
        switchChain: async (chainId: number) => getWalletClientForChain(chainId),
      }),
    ],
    // Disable chain preloading - we're on forks, not real networks
    preloadChains: true,
  });
}

// ============================================================
// EXPORTS
// ============================================================

export {
  ChainId,
  LOCAL_FORK_URL,
  TENDERLY_BASE_URL,
};
