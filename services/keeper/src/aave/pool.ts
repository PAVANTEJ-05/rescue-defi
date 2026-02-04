/**
 * Aave V3 Pool contract interface
 * Provides ABI and contract factory for Aave Pool interactions
 */

import { Contract, type Provider, type Signer } from "ethers";

/**
 * Minimal Aave V3 Pool ABI - only functions required for Rescue.ETH
 * getUserAccountData: monitoring health factor
 * repay: executing debt repayment
 */
export const AAVE_POOL_ABI = [
  // Read function for monitoring
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "getUserAccountData",
    outputs: [
      { internalType: "uint256", name: "totalCollateralBase", type: "uint256" },
      { internalType: "uint256", name: "totalDebtBase", type: "uint256" },
      { internalType: "uint256", name: "availableBorrowsBase", type: "uint256" },
      { internalType: "uint256", name: "currentLiquidationThreshold", type: "uint256" },
      { internalType: "uint256", name: "ltv", type: "uint256" },
      { internalType: "uint256", name: "healthFactor", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // Write function for repayment
  {
    inputs: [
      { internalType: "address", name: "asset", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "uint256", name: "interestRateMode", type: "uint256" },
      { internalType: "address", name: "onBehalfOf", type: "address" },
    ],
    name: "repay",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * ERC20 minimal ABI for token approvals
 */
export const ERC20_ABI = [
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Factory function to get Aave Pool contract instance
 * @param poolAddress - Deployed Aave V3 Pool address
 * @param providerOrSigner - Ethers provider (read-only) or signer (read-write)
 * @returns Contract instance bound to the pool
 */
export function getAavePool(
  poolAddress: string,
  providerOrSigner: Provider | Signer
): Contract {
  return new Contract(poolAddress, AAVE_POOL_ABI, providerOrSigner);
}

/**
 * Factory function to get ERC20 token contract instance
 * @param tokenAddress - ERC20 token address
 * @param providerOrSigner - Ethers provider or signer
 * @returns Contract instance bound to the token
 */
export function getERC20(
  tokenAddress: string,
  providerOrSigner: Provider | Signer
): Contract {
  return new Contract(tokenAddress, ERC20_ABI, providerOrSigner);
}
