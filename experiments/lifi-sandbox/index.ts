import {
  createConfig,
  config,
  type Route,
  ChainId,
  getRoutes,
  getStepTransaction,
  getStatus,
  EVM,
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
    account: ETH_WHALE,
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
      "https://virtual.rpc.tenderly.co/phoenix05/project/private/base-mainnet-lifi-test/44a26a37-95b7-489f-ad45-736c821e6a34",
    ],
  },
  providers: [
    EVM({
      getWalletClient: async () => mainnetWalletClient,
      switchChain: async (chainId) =>
        // Create a new wallet client for the requested chain
        getWalletClientForChain(chainId),
    }),
  ],
  preloadChains: true,
});
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http('https://virtual.rpc.tenderly.co/godofdeath/project/private/etherum-fork1/e0771959-4d8b-4382-9b62-c26eb29cd765'),
})
// Main Execution Function
async function main() {
  // Impersonate the whale account on the mainnet fork (optional)
  // await testClient.impersonateAccount(ETH_WHALE.address)
const ensText = await publicClient.getEnsText({
  name: normalize('nick.eth'),
  key: 'com.twitter',
})
console.log(ensText)

  console.log("Getting routes...");
  const result = await getRoutes({
    fromChainId: ChainId.ETH,
    toChainId: ChainId.BAS,
    fromTokenAddress: "0x0000000000000000000000000000000000000000", // ETH on ETH
    toTokenAddress: USDC_BASE_ADDRESS, // USDC on Base
    fromAmount: "30000000000000000",
    fromAddress: ETH_WHALE.address, // Use the whale address
  });

  // console.log(config.get())

  if (!result.routes.length) {
    console.error("No routes found");
    return;
  }

  const route = result.routes[0];
  if (!route) return;

  console.log("Route found:", route.id);
//   await executeRouteSteps(route);


// Contract call quote transacrtion request
 const contractCallQuote = await getContractCallsQuote(contractCallsQuoteRequest);
console.log(contractCallQuote)
  // After execution, show balances for the test wallet across chains
 const balance = await getTokenBalancesByChain(ETH_WHALE.address, tokensByChain)

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
            `  ${symbol} (${address}) = ${formatAmount(amt, Number(decimals))} (decimals=${decimals})`
        );
    });
});
}

const contractCallsQuoteRequest = {
  fromAddress: ETH_WHALE.address,
  fromChain: 1,
  fromToken: '0x0000000000000000000000000000000000000000',
  toAmount: '8500000000000',
  toChain: 8453,
  toToken: '0x0000000000000000000000000000000000000000',
  contractCalls: [
    {
      fromAmount: '8500000000000',
      fromTokenAddress: '0x0000000000000000000000000000000000000000',
      toContractAddress: '0x0000000000000068F116a894984e2DB1123eB395',
      toContractCallData:
        '0xe7acab24000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000006e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000029dacdf7ccadf4ee67c923b4c22255a4b2494ed700000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000520000000000000000000000000000000000000000000000000000000000000064000000000000000000000000090884b5bd9f774ed96f941be2fb95d56a029c99c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000022000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000066757dd300000000000000000000000000000000000000000000000000000000669d0a580000000000000000000000000000000000000000000000000000000000000000360c6ebe0000000000000000000000000000000000000000ad0303de3e1093e50000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f000000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000029f25e8a71e52e795e5016edf7c9e02a08c519b40000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006ff0cbadd00000000000000000000000000000000000000000000000000000006ff0cbadd0000000000000000000000000090884b5bd9f774ed96f941be2fb95d56a029c99c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003179fcad000000000000000000000000000000000000000000000000000000003179fcad000000000000000000000000000000a26b00c1f0df003000390027140000faa7190000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008a88c37e000000000000000000000000000000000000000000000000000000008a88c37e000000000000000000000000009323bb21a4c6122f60713e4a1e38e7b94a40ce2900000000000000000000000000000000000000000000000000000000000000e3b5b41791fe051471fa3c2da1325a8147c833ad9a6609ffc07a37e2603de3111b262911aaf25ed6d131dd531574cf54d4ea61b479f2b5aaa2dff7c210a3d4e203000000f37ec094486e9092b82287d7ae66fbf8cd6148233c70813583e3264383afbd0484b80500070135f54edd2918ddd4260c840f8a6957160766a4e4ef941517f2a0ab3077a2ac6478f0ad7fad9b821766df11ca3fdb16a8e95782faaed6e0395df2f416651ac87a5c1edec0a36ad42555083e57cff59f4ad98617a48a3664b2f19d46f4db85e95271c747d03194b5cfdcfc86bb0b08fb2bc4936d6f75be03ab498d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      toContractGasLimit: '210000',
    },
  ],
};

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
