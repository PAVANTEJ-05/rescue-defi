/**
 * Aave V3 Pool ABI and contract factory
 * 
 * Minimal ABI containing only functions required for Rescue.ETH:
 * - getUserAccountData: Read health factor, collateral, debt
 * - supply: Add collateral to user position
 */

import { Contract, type Provider, type Signer } from 'ethers';

/**
 * Minimal Aave V3 Pool ABI
 * 
 * Only includes functions needed for:
 * 1. Monitoring (getUserAccountData)
 * 2. Supplying collateral (supply)
 * 
 * NO repay function - this is intentional per architecture constraints.
 */
export const AAVE_POOL_ABI = [
  // Read: Get user's aggregate position data
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'getUserAccountData',
    outputs: [
      { internalType: 'uint256', name: 'totalCollateralBase', type: 'uint256' },
      { internalType: 'uint256', name: 'totalDebtBase', type: 'uint256' },
      { internalType: 'uint256', name: 'availableBorrowsBase', type: 'uint256' },
      { internalType: 'uint256', name: 'currentLiquidationThreshold', type: 'uint256' },
      { internalType: 'uint256', name: 'ltv', type: 'uint256' },
      { internalType: 'uint256', name: 'healthFactor', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Write: Supply collateral
  {
    inputs: [
      { internalType: 'address', name: 'asset', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'address', name: 'onBehalfOf', type: 'address' },
      { internalType: 'uint16', name: 'referralCode', type: 'uint16' },
    ],
    name: 'supply',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/**
 * Minimal ERC20 ABI for token operations
 */
export const ERC20_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Get Aave Pool contract instance
 * @param poolAddress - Deployed Aave V3 Pool address
 * @param providerOrSigner - Ethers provider (read-only) or signer (read-write)
 */
export function getAavePool(
  poolAddress: string,
  providerOrSigner: Provider | Signer
): Contract {
  return new Contract(poolAddress, AAVE_POOL_ABI, providerOrSigner);
}

/**
 * Get ERC20 token contract instance
 * @param tokenAddress - ERC20 token address
 * @param providerOrSigner - Ethers provider or signer
 */
export function getERC20(
  tokenAddress: string,
  providerOrSigner: Provider | Signer
): Contract {
  return new Contract(tokenAddress, ERC20_ABI, providerOrSigner);
}
