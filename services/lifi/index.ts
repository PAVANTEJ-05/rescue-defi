import {
  createConfig,
  config,
  type Route,
  ChainId,
  getRoutes,
  getStepTransaction,
  getStatus,
  EVM,
  convertQuoteToRoute,
  executeRoute,
} from "@lifi/sdk";
import {
  createWalletClient,
  createTestClient,
  createPublicClient,
  http,
  parseEther,
  encodeFunctionData,
  type Chain,
  type WalletClient,
  publicActions,
  walletActions,
  parseAbi,
  keccak256,
  encodeAbiParameters,
  pad,
  toHex,
} from "viem";

import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, mainnet, optimism, polygon, base } from "viem/chains";
import { normalize } from "viem/ens";
import { getContractCallsQuote, getTokenBalancesByChain } from "@lifi/sdk";

// Setup Account and Client
// Use a single test private key across chains (forked mainnet). Keep existing key.
const ETH_WHALE = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
); // test whale private key
const chains = [arbitrum, mainnet, optimism, polygon, base];
const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AAVE_POOL_ADDRESS = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const tokensByChain = {
  1: [
    {
      chainId: 1,
      address: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      name: "ETH",
      decimals: 18,
      priceUSD: "2222.33",
    },
  ],
  8453: [
    {
      chainId: 8453,
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      name: "Base",
      decimals: 6,
      priceUSD: "0.9999",
    },
    {
      chainId: 8453,
      address: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      name: "Base",
      decimals: 18,
      priceUSD: "2222.33",
    },
  ],
};

// 1. Setup Test Client to impersonate (mainnet fork)
const testClient = createTestClient({
  chain: mainnet,
  mode: "anvil",
  transport: http("http://127.0.0.1:8545"),
})
  .extend(publicActions)
  .extend(walletActions);

// 2. Helper factories for per-chain wallet/public clients
// Keep the same account (ETH_WHALE) across chains for tests/forks.
function getWalletClientForChain(chainId: number) {
  const chain = chains.find((c) => c.id === chainId) as Chain | undefined;
  const transport =
    chainId === ChainId.BAS
      ? http(
          "https://virtual.rpc.tenderly.co/phoenix05/project/private/base-mainnet-lifi-test/44a26a37-95b7-489f-ad45-736c821e6a34",
        )
      : http("http://127.0.0.1:8545");

  return createWalletClient({
    account: "0xC3F2F6c9A765c367c33ED11827BB676250481ca7", // CHANGE THIS TO ETH_WHALE (ONCE DONE TESTING)
    chain: (chain ?? mainnet) as Chain,
    transport,
  });
}

function getPublicClientForChain(chainId: number) {
  const transport =
    chainId === ChainId.BAS
      ? http(
          "https://virtual.rpc.tenderly.co/phoenix05/project/private/base-mainnet-lifi-test/44a26a37-95b7-489f-ad45-736c821e6a34",
        )
      : http("http://127.0.0.1:8545");

  return createPublicClient({
    chain: chainId === ChainId.BAS ? base : mainnet,
    transport,
  });
}

// Base test client (for base-specific test actions like setBalance)
const baseTestClient = createTestClient({
  chain: base,
  mode: "anvil",
  transport: http(
    "https://virtual.rpc.tenderly.co/phoenix05/project/private/base-mainnet-lifi-test/44a26a37-95b7-489f-ad45-736c821e6a34",
  ),
})
  .extend(publicActions)
  .extend(walletActions);

// Default mainnet public & wallet clients (fork)
const mainnetWalletClient = getWalletClientForChain(ChainId.ETH);
const mainnetPublicClient = getPublicClientForChain(ChainId.ETH);

const WETH_BASE = "0x4200000000000000000000000000000000000006";
const WETH_ABI = parseAbi([
  "function deposit() payable",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

// USDC on Base — ABI (ERC20 minimal subset); USDC has standard transfer/balanceOf functions
const USDC_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const AAVE_POOL_ABI = parseAbi([
  // Read: Get user's aggregate position data
  "function getUserAccountData(address user) view returns (" +
    "uint256 totalCollateralBase," +
    "uint256 totalDebtBase," +
    "uint256 availableBorrowsBase," +
    "uint256 currentLiquidationThreshold," +
    "uint256 ltv," +
    "uint256 healthFactor" +
    ")",

  // Write: Supply collateral
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
]);

// Known USDC holder on Base (used for impersonation on the fork to transfer tokens)
const BASE_USDC_HOLDER = "0xc001F2D9DD70a8dbe12D073B60fdCD3610c77939";

// Helper to check balance
// const ERC20_ABI = parseAbi([
//     'function balanceOf(address owner) view returns (uint256)',
//     'function approve(address spender, uint256 amount) returns (bool)',
//     'function allowance(address owner, address spender) view returns (uint256)'
// ]);

// Unified Configuration
createConfig({
  integrator: "test-Lifi",
  rpcUrls: {
    [ChainId.ETH]: ["http://127.0.0.1:8545"],
    [ChainId.BAS]: [
      "https://virtual.rpc.tenderly.co/phoenix05/project/private/base-mainnet-lifi-test/44a26a37-95b7-489f-ad45-736c821e6a34"
    ],
  },
  providers: [
    EVM({
      getWalletClient: async () => mainnetWalletClient,
      switchChain: async (chainId) =>
        // Create a new wallet client for the requested chain
        getWalletClientForChain(chainId),
        // getPublicClient: async (chainId) => getPublicClientForChain(chainId),
    }),
  ],
  preloadChains: false,
});

// Main Execution Function
async function main() {
  // Impersonate the whale account on the mainnet fork (optional)
  await testClient.impersonateAccount({
    address: "0xC3F2F6c9A765c367c33ED11827BB676250481ca7",
  });


  // ============== GETTING ROUTES FOR NORMAL BRIDGE SWAP ===========
  //   console.log("Getting routes...");
  //   const result = await getRoutes({
  //     fromChainId: ChainId.ETH,
  //     toChainId: ChainId.BAS,
  //     fromTokenAddress: "0x0000000000000000000000000000000000000000", // ETH on ETH
  //     toTokenAddress: USDC_BASE_ADDRESS, // USDC on Base
  //     fromAmount: "30000000000000000",
  //     fromAddress: ETH_WHALE.address, // Use the whale address
  //   });

  //   // console.log(config.get())

  //   if (!result.routes.length) {
  //     console.error("No routes found");
  //     return;
  //   }

  //   const route = result.routes[0];
  //   if (!route) return;

  //   console.log("Route found:", route.id);
  // //   await executeRouteSteps(route);

  // ================= CONTRACT CALL QUOTE AND EXECUTION OF TXN =================
  // Contract call quote transacrtion request
  const contractCallQuote = await getContractCallsQuote(
    contractCallsQuoteRequest,
  );
  console.log(contractCallQuote);
  const fromChainId = contractCallQuote.action.fromChainId;
  const currentClient = getWalletClientForChain(fromChainId);
  const currentPublicClient = getPublicClientForChain(fromChainId);

  // Remove gas fields to let viem/local node estimate them for the fork
  const { gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, ...txRequest } =
    contractCallQuote.transactionRequest as any;
  console.log("txn will be sent after this , txRequest:-----", txRequest);

  const transactionHash = await currentClient.sendTransaction(txRequest);
  console.log(`Transaction sent: ${transactionHash}`);

  console.log("Waiting for local confirmation...");
  const receipt = await currentPublicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  console.log(`Transaction mined in block ${receipt.blockNumber}`);

// TO-DO: SIMULATE THE CONTRACT CALL ON BASE MAINNET ON TENDERLY URL USING CHEATCODES (IF POSSIBLE ALSO MANIULATE THE HF OF AAVE CONTRACT ON TARGET CHAIN)


  //===========    CHECKING TOKEN BALANCES AFTER TRANSFER ==============
  // After execution, show balances for the test wallet across chains
  const balance = await getTokenBalancesByChain(
    ETH_WHALE.address,
    tokensByChain,
  );
console.log(balance)
  // Display balances per chain/token (handles bigint amounts)
  function formatAmount(amount: bigint, decimals: number) {
    const sign = amount < 0n ? "-" : "";
    const a = amount < 0n ? -amount : amount;
    const base = 10n ** BigInt(decimals);
    const integer = a / base;
    let fraction = (a % base).toString().padStart(decimals, "0");
    fraction = fraction.replace(/0+$/, ""); // trim trailing zeros
    return `${sign}${integer.toString()}${fraction ? "." + fraction : ""}`;
  }

  Object.entries(balance ?? {}).forEach(([chainId, tokens]) => {
    console.log(`Chain ${chainId}:`);
    (tokens ?? []).forEach((t: any) => {
      const { address, symbol, amount, decimals } = t;
      const amt = typeof amount === "bigint" ? amount : BigInt(amount);
      console.log(
        `  ${symbol} (${address}) = ${formatAmount(amt, Number(decimals))} (decimals=${decimals})`,
      );
    });
  });
}

// Calldata for the contract call for aave
const calldata = encodeFunctionData({
  abi: AAVE_POOL_ABI,
  functionName: "supply",
  args: [USDC_BASE_ADDRESS, BigInt(8500000), ETH_WHALE.address, 0], // refer abi code of aave to pass what arguments
});

const contractCallsQuoteRequest = {
  fromAddress: "0xC3F2F6c9A765c367c33ED11827BB676250481ca7", // replace by contract address of executor contract which keeper calls
  fromChain: 1,
  fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  toAmount: "8500000",
  toChain: 8453,
  toToken: USDC_BASE_ADDRESS,
  contractCalls: [
    {
      fromAmount: "8500000",
      fromTokenAddress: USDC_BASE_ADDRESS,
      toContractAddress: AAVE_POOL_ADDRESS,
      toContractCallData: calldata,
      toContractGasLimit: "500000",
    },
  ],
};



// ===================== EXECUTE ROUTE STEPS =================================
// Simplified example function to execute each step of the route sequentially
async function executeRouteSteps(route: Route) {
  for (const stepInfo of route.steps) {
    // Request transaction data for the current step
    console.log("stepInfo:---------", stepInfo);
    const step = await getStepTransaction(stepInfo);
    console.log("Step transaction data received:---------", step);

    // Validate transactionRequest
    if (!step.transactionRequest) {
      console.error("Missing transactionRequest for step", stepInfo);
      return;
    }

    console.log("--------sending ----transaction\n");

    // Choose the correct wallet and public clients for the step's fromChain
    const fromChainId = step.action.fromChainId;
    const currentClient = getWalletClientForChain(fromChainId);
    const currentPublicClient = getPublicClientForChain(fromChainId);

    // Remove gas fields to let viem/local node estimate them for the fork
    const { gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, ...txRequest } =
      step.transactionRequest as any;
    console.log("txn will be sent after this , txRequest:-----", txRequest);

    const transactionHash = await currentClient.sendTransaction(txRequest);
    console.log(`Transaction sent: ${transactionHash}`);

    console.log("Waiting for local confirmation...");
    const receipt = await currentPublicClient.waitForTransactionReceipt({
      hash: transactionHash,
    });
    console.log(`Transaction mined in block ${receipt.blockNumber}`);

    // --- SIMULATION BLOCK ---
    // Since we are on local forks, the real bridge relayers cannot see this transaction.
    // We must manually simulate the arrival of funds on the Destination Chain (Base).
    if (step.action.toChainId === ChainId.BAS) {
      console.log("\n--- SIMULATING BRIDGE ARRIVAL ON BASE ---");
      console.log(
        "Real bridges (Squid/Axelar) cannot detect transactions on local forks.",
      );
      console.log(
        "Manually verifying and minting tokens on Base to continue testing...",
      );

      // 1. Fund the test wallet with ETH on Base (so it can pay gas / wrap)
      await baseTestClient.setBalance({
        address: ETH_WHALE.address,
        value: parseEther("1"),
      });

      console.log("Simulated: Funded user with 1 ETH on Base");

      // 2. Credit USDC on Base to the test wallet by impersonating a USDC holder
      const amountToMint = BigInt(step.estimate.toAmount);
      console.log(
        `Simulating delivery of ${amountToMint} base-token units (USDC) to ${ETH_WHALE.address}...`,
      );

      try {
        // Impersonate a known USDC holder on Base and transfer USDC to the test wallet
        // await baseTestClient.impersonateAccount({address: BASE_USDC_HOLDER});

        const baseUsdcHolderClient = createWalletClient({
          account: BASE_USDC_HOLDER,
          chain: base,
          transport: http(
            "https://virtual.rpc.tenderly.co/phoenix05/project/private/base-mainnet-lifi-test/44a26a37-95b7-489f-ad45-736c821e6a34",
          ),
        });

        const transferData = encodeFunctionData({
          abi: USDC_ABI,
          functionName: "transfer",
          args: [ETH_WHALE.address, amountToMint],
        });

        await baseUsdcHolderClient.sendTransaction({
          to: USDC_BASE_ADDRESS,
          data: transferData,
          value: 0n,
        });

        // Stop impersonation if the test client supports it
        try {
          //   await baseTestClient.stopImpersonatingAccount(BASE_USDC_HOLDER);
        } catch (e) {
          // not critical
        }

        console.log(
          `Simulated: USDC transferred on Base to ${ETH_WHALE.address}`,
        );
      } catch (err) {
        console.error(
          "Failed to simulate USDC delivery by impersonation:",
          err,
        );
        console.log(
          "You may need to adjust the holder address or run this against a fork that contains the holder with balance.",
        );
      }
      console.log("--- BRIDGE SIMULATION COMPLETE ---\n");
    }
  }

  console.log("All steps executed successfully");
}

// Run main
main().catch(console.error);
