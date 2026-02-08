/**
 * LI.FI Demo Script for Rescue.ETH
 * 
 * ============================================================
 * DEMO-ONLY - DO NOT USE IN PRODUCTION
 * ============================================================
 * 
 * This script demonstrates the full LI.FI integration flow:
 * 1. Initialize LI.FI SDK with fork-compatible config
 * 2. Build a contractCallsQuote request for Aave supply
 * 3. Execute the transaction on a forked network
 * 4. (Optional) Simulate bridge arrival on destination
 * 5. Check token balances
 * 
 * PREREQUISITES:
 * - Anvil mainnet fork running on port 8546
 * - Tenderly virtual testnet for Base (URL in config)
 * - Impersonation-capable test environment
 * 
 * RUN WITH:
 *   cd keeper && npx tsx lifi/demo.ts
 * 
 * ============================================================
 * ORIGINAL FILE: keeper/lifi/index.ts
 * This is the restructured demo code from the original monolithic file.
 * Logic is UNCHANGED - only split into modules for clarity.
 * ============================================================
 */

import {
  createConfig,
  type Route,
  ChainId,
  getRoutes,
  getStepTransaction,
  EVM,
  getContractCallsQuote,
  getTokenBalancesByChain,
} from '@lifi/sdk';
import {
  createWalletClient,
  createTestClient,
  createPublicClient,
  http,
  parseEther,
  encodeFunctionData,
  type Chain,
  publicActions,
  walletActions,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, mainnet, optimism, polygon, base } from 'viem/chains';

// Import from modular structure
import {
  initializeLiFiConfig,
  getWalletClientForChain,
  getPublicClientForChain,
  mainnetTestClient,
  baseTestClient,
  TENDERLY_BASE_URL,
} from './lifi-config.js';
import {
  AAVE_POOL_ABI,
  encodeAaveSupplyCalldata,
} from '../lifi/quote.js';

// Demo-only constants (these are in chainConfig for production)
const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AAVE_POOL_ADDRESS = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
import { simulateUsdcBridgeArrival, fundWithNativeToken, formatTokenAmount } from './lifi-simulate.js';

// ============================================================
// TEST ACCOUNT CONFIGURATION
// ============================================================

/**
 * Test whale account (Anvil default account #0)
 * 
 * This is a well-known test private key - NEVER use on mainnet.
 * It's pre-funded on Anvil forks and commonly used for testing.
 */
const ETH_WHALE = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
);

/**
 * Demo address used for contract call execution
 * 
 * CHANGE THIS TO ETH_WHALE.address ONCE DONE TESTING
 * Currently hardcoded for specific demo scenarios.
 */
const DEMO_FROM_ADDRESS = '0xC3F2F6c9A765c367c33ED11827BB676250481ca7';

// ============================================================
// TOKEN CONFIGURATION FOR BALANCE TRACKING
// ============================================================

/**
 * Tokens to track for balance display
 * Organized by chain ID
 */
const tokensByChain = {
  1: [
    {
      chainId: 1,
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      name: 'ETH',
      decimals: 18,
      priceUSD: '2222.33',
    },
  ],
  8453: [
    {
      chainId: 8453,
      address: USDC_BASE_ADDRESS,
      symbol: 'USDC',
      name: 'Base',
      decimals: 6,
      priceUSD: '0.9999',
    },
    {
      chainId: 8453,
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      name: 'Base',
      decimals: 18,
      priceUSD: '2222.33',
    },
  ],
};

// ============================================================
// ADDITIONAL ABIs (from original file)
// ============================================================

const USDC_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

/**
 * Known USDC holder on Base
 * Used for impersonation in bridge simulation
 */
const BASE_USDC_HOLDER = '0xc001F2D9DD70a8dbe12D073B60fdCD3610c77939';

// ============================================================
// MAIN DEMO FUNCTION
// ============================================================

/**
 * Main demo execution
 * 
 * This demonstrates the full rescue flow:
 * 1. Impersonate a test account on mainnet fork
 * 2. Build contractCallsQuote for bridging + Aave supply
 * 3. Execute the transaction
 * 4. Display resulting balances
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Rescue.ETH LI.FI Demo');
  console.log('='.repeat(60));
  console.log('');
  console.log('This demo shows:');
  console.log('  1. Building a contractCallsQuote (bridge + Aave supply)');
  console.log('  2. Executing on a forked network');
  console.log('  3. Checking token balances');
  console.log('');
  console.log('NOTE: Real bridges cannot see fork transactions.');
  console.log('Bridge simulation would be needed for full E2E testing.');
  console.log('');
  console.log('='.repeat(60));

  // Initialize LI.FI SDK
  initializeLiFiConfig();

  // // Impersonate the demo account on mainnet fork
  // await mainnetTestClient.impersonateAccount({
  //   address: DEMO_FROM_ADDRESS as `0x${string}`,
  // });
  // console.log(`Impersonating: ${DEMO_FROM_ADDRESS}`);

  // ============================================================
  // CONTRACT CALLS QUOTE EXECUTION
  // ============================================================
  
  // Build calldata for Aave supply
  const supplyAmount = BigInt(8500000); // 8.5 USDC
  const calldata = encodeAaveSupplyCalldata(
    USDC_BASE_ADDRESS as `0x${string}`,
    supplyAmount,
    ETH_WHALE.address
  );

  // Build the contractCallsQuote request
  const contractCallsQuoteRequest = {
    fromAddress: DEMO_FROM_ADDRESS,
    fromChain: 1, // Mainnet
    fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on mainnet
    toAmount: '8500000',
    toChain: 8453, // Base
    toToken: USDC_BASE_ADDRESS,
    contractCalls: [
      {
        fromAmount: '8500000',
        fromTokenAddress: USDC_BASE_ADDRESS,
        toContractAddress: AAVE_POOL_ADDRESS,
        toContractCallData: calldata,
        toContractGasLimit: '500000',
      },
    ],
  };

  console.log('\nFetching contractCallsQuote...');
  console.log('  From: Mainnet USDC');
  console.log('  To: Base USDC → Aave supply()');
  console.log('  Amount: 8.5 USDC');

  const contractCallQuote = await getContractCallsQuote(contractCallsQuoteRequest);
  console.log('\nQuote received:', contractCallQuote);
  console.log('  Route ID:', (contractCallQuote as any).id || 'N/A');
  console.log('  Tool:', (contractCallQuote as any).tool || 'N/A');

  // Get clients for the source chain
  const fromChainId = contractCallQuote.action.fromChainId;
  const currentClient = getWalletClientForChain(fromChainId);
  const currentPublicClient = getPublicClientForChain(fromChainId);

  // Strip gas fields for fork execution
  const { gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, ...txRequest } =
    contractCallQuote.transactionRequest as any;

  console.log('\nSubmitting transaction...');
  console.log('  To:', txRequest.to);
  console.log('  Value:', txRequest.value?.toString() || '0');

  const transactionHash = await currentClient.sendTransaction(txRequest);
  console.log(`\nTransaction submitted: ${transactionHash}`);

  console.log('Waiting for confirmation...');
  const receipt = await currentPublicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  // ============================================================
  // TODO: BRIDGE SIMULATION
  // ============================================================
  
  console.log('\n' + '='.repeat(60));
  console.log('TODO: BRIDGE SIMULATION');
  console.log('='.repeat(60));
  console.log('');
  console.log('The transaction above locked tokens on mainnet fork.');
  console.log('Real bridges cannot see this - manual simulation needed.');
  console.log('');
  console.log('To complete E2E testing:');
  console.log('  1. Call simulateUsdcBridgeArrival() from simulate.ts');
  console.log('  2. Or manipulate HF on target chain via Tenderly');
  console.log('');

  // ============================================================
  // BALANCE CHECK
  // ============================================================
  
  console.log('\n' + '='.repeat(60));
  console.log('TOKEN BALANCES');
  console.log('='.repeat(60));

  const balance = await getTokenBalancesByChain(ETH_WHALE.address, tokensByChain);

  Object.entries(balance ?? {}).forEach(([chainId, tokens]) => {
    console.log(`\nChain ${chainId}:`);
    const tokenList = Array.isArray(tokens) ? tokens : [];
    tokenList.forEach((t: any) => {
      const { address, symbol, amount, decimals } = t;
      const amt = typeof amount === 'bigint' ? amount : BigInt(amount);
      console.log(
        `  ${symbol} (${address.slice(0, 10)}...) = ${formatTokenAmount(amt, Number(decimals))}`
      );
    });
  });

  console.log('\n' + '='.repeat(60));
  console.log('Demo complete');
  console.log('='.repeat(60));
}

// ============================================================
// ROUTE EXECUTION (ALTERNATIVE FLOW)
// ============================================================

/**
 * Execute all steps of a LI.FI route
 * 
 * This is an alternative flow using standard getRoutes instead of
 * contractCallsQuote. Preserved from original for reference.
 * 
 * NOTE: Standard routes do NOT include contract calls on destination.
 * For Rescue.ETH, prefer contractCallsQuote.
 */
async function executeRouteSteps(route: Route) {
  for (const stepInfo of route.steps) {
    console.log('Processing step:', stepInfo.id);
    
    const step = await getStepTransaction(stepInfo);
    
    if (!step.transactionRequest) {
      console.error('Missing transactionRequest for step');
      return;
    }

    const fromChainId = step.action.fromChainId;
    const currentClient = getWalletClientForChain(fromChainId);
    const currentPublicClient = getPublicClientForChain(fromChainId);

    // Strip gas fields for fork
    const { gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, ...txRequest } =
      step.transactionRequest as any;

    const transactionHash = await currentClient.sendTransaction(txRequest);
    console.log(`Transaction sent: ${transactionHash}`);

    const receipt = await currentPublicClient.waitForTransactionReceipt({
      hash: transactionHash,
    });
    console.log(`Mined in block ${receipt.blockNumber}`);

    // Simulate bridge arrival if destination is Base
    if (step.action.toChainId === ChainId.BAS) {
      console.log('\n--- SIMULATING BRIDGE ARRIVAL ON BASE ---');
      
      // Fund with ETH for gas
      await baseTestClient.setBalance({
        address: ETH_WHALE.address,
        value: parseEther('1'),
      });

      // Transfer USDC
      const amountToMint = BigInt(step.estimate.toAmount);
      
      try {
        const baseUsdcHolderClient = createWalletClient({
          account: BASE_USDC_HOLDER as `0x${string}`,
          chain: base,
          transport: http(TENDERLY_BASE_URL),
        });

        const transferData = encodeFunctionData({
          abi: USDC_ABI,
          functionName: 'transfer',
          args: [ETH_WHALE.address, amountToMint],
        });

        await baseUsdcHolderClient.sendTransaction({
          to: USDC_BASE_ADDRESS as `0x${string}`,
          data: transferData,
          value: 0n,
        });

        console.log(`Simulated USDC delivery to ${ETH_WHALE.address}`);
      } catch (err) {
        console.error('Failed to simulate USDC delivery:', err);
      }
      
      console.log('--- BRIDGE SIMULATION COMPLETE ---\n');
    }
  }

  console.log('All steps executed successfully');
}

// ============================================================
// ENTRY POINT
// ============================================================

main().catch(console.error);
