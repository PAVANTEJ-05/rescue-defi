/**
 * Bridge Simulation for Rescue.ETH Demo
 * 
 * ============================================================
 * DEMO-ONLY - THIS IS NOT PRODUCTION CODE
 * ============================================================
 * 
 * WHY THIS EXISTS:
 * Real bridge relayers (Squid, Axelar, Stargate, etc.) monitor REAL networks.
 * They CANNOT see transactions on local Anvil forks or Tenderly virtual testnets.
 * 
 * When we send a bridge transaction on a fork:
 * - The transaction succeeds on the source chain (fork)
 * - Tokens are "locked" in the bridge contract
 * - But NO relayer picks it up
 * - Tokens NEVER arrive on the destination chain
 * 
 * SOLUTION FOR DEMO:
 * Manually simulate the bridge arrival by:
 * 1. Impersonating a whale/holder on the destination chain
 * 2. Transferring tokens to the recipient
 * 3. Or using test client to mint/set balance
 * 
 * PRODUCTION DIFFERENCES:
 * - This entire module is UNNECESSARY on real networks
 * - Real relayers automatically complete the bridge
 * - Tokens arrive within minutes (varies by bridge)
 * - No manual intervention needed
 * 
 * ============================================================
 * WHEN TO USE THIS:
 * - After executing a bridge transaction on a forked source chain
 * - Before checking destination chain balances
 * - Before attempting Aave operations on destination
 * ============================================================
 */

import {
  createWalletClient,
  http,
  encodeFunctionData,
  parseEther,
  parseAbi,
} from 'viem';
import { base } from 'viem/chains';
import { ChainId } from '@lifi/sdk';
import { baseTestClient, TENDERLY_BASE_URL } from './config.js';
import type { BridgeSimulationParams } from './types.js';

// ============================================================
// TOKEN CONFIGURATION
// ============================================================

/**
 * Known token holders for impersonation
 * 
 * These addresses hold significant token balances on various chains.
 * Used to impersonate and transfer tokens to test wallets.
 * 
 * WARNING: These may change over time as holders move funds.
 * Verify balances if simulation fails.
 */
export const TOKEN_HOLDERS = {
  // USDC holders on Base
  [ChainId.BAS]: {
    USDC: '0xc001F2D9DD70a8dbe12D073B60fdCD3610c77939',
  },
} as const;

/**
 * Token addresses by chain
 */
export const TOKEN_ADDRESSES = {
  [ChainId.BAS]: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    WETH: '0x4200000000000000000000000000000000000006',
  },
} as const;

/**
 * Standard ERC20 ABI for transfers
 */
const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

/**
 * WETH ABI for deposit (wrapping ETH)
 */
const WETH_ABI = parseAbi([
  'function deposit() payable',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);

// ============================================================
// SIMULATION FUNCTIONS
// ============================================================

/**
 * Fund a wallet with native ETH on the destination chain
 * 
 * Uses test client's setBalance cheatcode to mint ETH.
 * This is required so the recipient can pay gas for further operations.
 * 
 * @param recipientAddress - Address to fund
 * @param amount - Amount in ETH (default 1 ETH)
 */
export async function fundWithNativeToken(
  recipientAddress: `0x${string}`,
  amount: string = '1'
): Promise<void> {
  console.log(`Funding ${recipientAddress} with ${amount} ETH on Base...`);
  
  await baseTestClient.setBalance({
    address: recipientAddress,
    value: parseEther(amount),
  });
  
  console.log('Native token funding complete');
}

/**
 * Simulate USDC bridge arrival on Base
 * 
 * This impersonates a known USDC holder and transfers tokens to the recipient.
 * Used to simulate what would happen when a real bridge completes.
 * 
 * @param recipientAddress - Address to receive tokens
 * @param amount - Amount in token units (e.g., 8500000 = 8.5 USDC)
 */
export async function simulateUsdcBridgeArrival(
  recipientAddress: `0x${string}`,
  amount: bigint
): Promise<void> {
  console.log('\n--- SIMULATING BRIDGE ARRIVAL ON BASE ---');
  console.log('Real bridges (Squid/Axelar) cannot detect transactions on local forks.');
  console.log('Manually transferring tokens to simulate bridge completion...');

  const holders = TOKEN_HOLDERS[ChainId.BAS];
  const addresses = TOKEN_ADDRESSES[ChainId.BAS];
  if (!holders || !addresses) {
    throw new Error('Token holders/addresses not configured for Base');
  }
  const holderAddress = holders.USDC;
  const usdcAddress = addresses.USDC;

  // Create wallet client for the holder (impersonation via Tenderly)
  const holderClient = createWalletClient({
    account: holderAddress as `0x${string}`,
    chain: base,
    transport: http(TENDERLY_BASE_URL),
  });

  // Encode transfer calldata
  const transferData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [recipientAddress, amount],
  });

  console.log(`Transferring ${amount} USDC units to ${recipientAddress}...`);

  try {
    const hash = await holderClient.sendTransaction({
      to: usdcAddress,
      data: transferData,
      value: 0n,
    });

    console.log(`Transfer submitted: ${hash}`);
    console.log(`Simulated: USDC transferred on Base to ${recipientAddress}`);
  } catch (error) {
    console.error('Failed to simulate USDC delivery:', error);
    console.log('You may need to:');
    console.log('  1. Verify the holder address has sufficient balance');
    console.log('  2. Check Tenderly virtual testnet is running');
    console.log('  3. Update TOKEN_HOLDERS if the whale moved funds');
    throw error;
  }

  console.log('--- BRIDGE SIMULATION COMPLETE ---\n');
}

/**
 * Full bridge simulation for a route step
 * 
 * This is the main function called after a bridge transaction executes
 * on the source chain. It:
 * 1. Funds the recipient with native ETH (for gas)
 * 2. Transfers the bridged tokens to the recipient
 * 
 * @param params - Simulation parameters
 */
export async function simulateBridgeArrival(
  params: BridgeSimulationParams
): Promise<void> {
  const { recipientAddress, amount, tokenAddress, chainId } = params;

  // Only Base is supported currently
  if (chainId !== ChainId.BAS) {
    console.warn(`Bridge simulation not implemented for chain ${chainId}`);
    console.warn('Only Base (8453) is supported in this demo');
    return;
  }

  // Step 1: Fund with native ETH for gas
  await fundWithNativeToken(recipientAddress as `0x${string}`);

  // Step 2: Transfer the bridged tokens
  const baseAddresses = TOKEN_ADDRESSES[ChainId.BAS];
  if (!baseAddresses) {
    console.warn('Token addresses not configured for Base');
    return;
  }
  const baseUsdc = baseAddresses.USDC;
  if (tokenAddress.toLowerCase() === baseUsdc.toLowerCase()) {
    await simulateUsdcBridgeArrival(recipientAddress as `0x${string}`, amount);
  } else {
    console.warn(`Token ${tokenAddress} simulation not implemented`);
    console.warn('Only USDC on Base is supported in this demo');
  }
}

/**
 * Simulate bridge arrival for a LI.FI route step
 * 
 * Convenience function that extracts parameters from a route step
 * and calls the appropriate simulation.
 * 
 * @param step - LI.FI route step that was executed
 * @param recipientAddress - Address that should receive tokens
 */
export async function simulateStepBridgeArrival(
  step: any,
  recipientAddress: `0x${string}`
): Promise<void> {
  const toChainId = step.action.toChainId;
  
  // Only simulate if destination is a chain we support
  if (toChainId !== ChainId.BAS) {
    console.log(`Skipping simulation for chain ${toChainId} (not Base)`);
    return;
  }

  const amount = BigInt(step.estimate.toAmount);
  const tokenAddress = step.action.toToken.address;

  await simulateBridgeArrival({
    recipientAddress,
    amount,
    tokenAddress,
    chainId: toChainId,
  });
}

// ============================================================
// BALANCE CHECKING
// ============================================================

/**
 * Check token balance after simulation
 * 
 * Utility to verify the simulation worked correctly.
 * 
 * @param tokenAddress - Token contract address
 * @param walletAddress - Wallet to check
 * @returns Balance in token units
 */
export async function checkTokenBalance(
  tokenAddress: `0x${string}`,
  walletAddress: `0x${string}`
): Promise<bigint> {
  const balance = await baseTestClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  });

  return balance as bigint;
}

/**
 * Format token amount for display
 * 
 * @param amount - Amount in token units
 * @param decimals - Token decimals
 * @returns Formatted string
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  const sign = amount < 0n ? '-' : '';
  const absAmount = amount < 0n ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const integer = absAmount / base;
  let fraction = (absAmount % base).toString().padStart(decimals, '0');
  fraction = fraction.replace(/0+$/, ''); // trim trailing zeros
  return `${sign}${integer.toString()}${fraction ? '.' + fraction : ''}`;
}
