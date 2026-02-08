/**
 * ============================================================
 * LEGACY REFERENCE — DO NOT USE IN PRODUCTION
 * ============================================================
 * This file contains the AUTHORITATIVE transaction logic that was used
 * to validate the correct 4-parameter `executeRescue` call and the
 * `getContractCallsQuote` flow on a forked Optimism environment.
 *
 * The correct logic from this file has been extracted into:
 *   - lifi/execute.ts  (production executeRescue with correct ABI)
 *   - lifi/quote.ts    (production quote building with configurable Aave pool)
 *
 * DO NOT modify this file. It is preserved as a reference for auditing
 * the original transaction flow against the production implementation.
 * ============================================================
 */

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
// const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const AAVE_USER = "0xb789576d412aeec021fe01ded9541b272f472aab";

const AAVE_POOL_ADDRESS = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
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
  10: [
    {
      chainId: 10,
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      name: "op",
      decimals: 18,
      priceUSD: "0.9999",
    },
    {
      chainId: 8453,
      address: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      name: "op",
      decimals: 18,
      priceUSD: "2222.33",
    },
  ],
};

// 2. Helper factories for per-chain wallet/public clients
// Keep the same account (ETH_WHALE) across chains for tests/forks.
function getWalletClientForChain(chainId: number) {
  const chain = chains.find((c) => c.id === chainId) as Chain | undefined;
  const transport =
    chainId === ChainId.OPT
      ? http(
          "http://127.0.0.1:8545",
        )
      : http();

  return createWalletClient({
    account: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // CHANGE THIS TO ETH_WHALE (ONCE DONE TESTING) ---(executor contract)
    chain: (chain ?? mainnet) as Chain,
    transport,
  });
}

function getPublicClientForChain(chainId: number) {
  const transport =
    chainId === ChainId.OPT
      ? http(
          "http://127.0.0.1:8545",
        )
      : http("http://127.0.0.1:8545");

  return createPublicClient({
    chain: chainId === ChainId.OPT ? optimism : mainnet,
    transport,
  });
}

// Base test client (for base-specific test actions like setBalance)
const baseTestClient = createTestClient({
  chain: base,
  mode: "anvil",
  transport: http(
    "http://127.0.0.1:8545",
  ),
})
  .extend(publicActions)
  .extend(walletActions);

// Default mainnet public & wallet clients (fork)
const mainnetWalletClient = getWalletClientForChain(ChainId.OPT);
const mainnetPublicClient = getPublicClientForChain(ChainId.OPT);

// const EXECUTOR_CONTRACT = "0x825794255ae3960f62de3fc3e0e94ee2a4887f73"; // original
const EXECUTOR_CONTRACT = "0xa3730ab689e9e5e5d756f1d851e207b4317b3883";
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
const OP_WETH = "0x4200000000000000000000000000000000000006";
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
    [ChainId.OPT]: [
      "http://127.0.0.1:8545",
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

const RESCUE_EXECUTOR_ABI = parseAbi([
  // =========================
  // Constructor
  // =========================
  "constructor(address _keeper, address _lifiRouter, uint256 _cooldownSeconds)",

  // =========================
  // Errors
  // =========================
  "error OnlyKeeper()",
  "error CooldownActive(uint256 remaining)",
  "error InvalidTarget()",
  "error ERC20TransferFailed()",
  "error ERC20ApproveFailed()",
  "error LiFiCallFailed()",
  "error ResidualBalance()",

  // =========================
  // Events
  // =========================
  "event RescueExecuted(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 timestamp)",

  // =========================
  // View / Public Variables
  // =========================
  "function keeper() view returns (address)",
  "function lifiRouter() view returns (address)",
  "function COOLDOWN_SECONDS() view returns (uint256)",
  "function lastRescueAt(address user) view returns (uint256)",

  // =========================
  // Core Function
  // =========================
  "function executeRescue(address user, address tokenIn, uint256 amountIn, bytes callData) external payable",

  // =========================
  // Receive ETH
  // =========================
  "receive() external payable",
]);

// Main Execution Function
async function main() {
  const keeperWallet = createWalletClient({
    account: ETH_WHALE, // CHANGE THIS TO ETH_WHALE (ONCE DONE TESTING) ---(executor contract)
    chain: optimism,
    transport: http(
      "http://127.0.0.1:8545",
    ),
  });

  // ================= CONTRACT CALL QUOTE AND EXECUTION OF TXN =================
  // Build calldata for the Aave supply call
  const calldata = encodeFunctionData({
    abi: AAVE_POOL_ABI,
    functionName: "supply",
    args: [
      OP_WETH,
      BigInt(8500000000000),
      "0xb87e30d0351dc5770541b3233e13c8cf810b287b",
      0,
    ], // refer abi code of aave to pass what arguments
  });

  // Contract call quote transaction request (must be defined before use)
  const contractCallsQuoteRequest = {
    fromAddress: EXECUTOR_CONTRACT, // replace with contract address of executor_contract which keeper calls
    fromChain: 10,
    fromToken: OP_WETH,
    toAmount: "8500000000000", // Must match fromAmount for same-chain contract calls
    toChain: 10,
    toToken: OP_WETH,
    contractCalls: [
      {
        fromAmount: "8500000000000",
        fromTokenAddress: OP_WETH,
        toContractAddress: AAVE_POOL_ADDRESS,
        toContractCallData: calldata,
        toContractGasLimit: "500000000",
        toApprovalAddress: AAVE_POOL_ADDRESS,
      },
    ],
  };

  // Contract call quote transaction request
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

  // ─────────────────────────────────────────────────────────────────────────
  // OPTION A — Send the LiFi calldata DIRECTLY to the LiFi Diamond router
  //            (bypasses RescueExecutor; good for verifying the LiFi quote
  //             actually works on a FRESH fork with up-to-date facets)
  // ─────────────────────────────────────────────────────────────────────────
  // NOTE: The LiFi Diamond on Tenderly forks can be stale.  Selector
  //       0xa83cbaa3 (or similar) may not be registered as a facet if the
  //       fork was created before LiFi upgraded their diamond.
  //       ➜  FIX: recreate the Tenderly fork so the diamond matches the
  //              live chain, then this path will work.
//   const transactionHash = await currentClient.sendTransaction(txRequest);

//   console.log(`Transaction sent: ${transactionHash}`);

//   console.log("Waiting for local confirmation...");
//   const receipt = await currentPublicClient.waitForTransactionReceipt({
//     hash: transactionHash,
//   });
//   console.log(`Transaction mined in block ${receipt.blockNumber}`);

  // ─────────────────────────────────────────────────────────────────────────
  // OPTION B — Route through RescueExecutor  (uncomment once the fork is
  //            recreated so the LiFi Diamond has the required facets)
  //
  //  The RescueExecutor forwards `callData` to `lifiRouter` via:
  //      target.call{value: msg.value}(callData)
  //
  //  `contractCallQuote.transactionRequest.data` IS the full calldata the
  //  LiFi API expects to be sent to the Diamond.  So passing it as the
  //  `callData` arg to executeRescue is correct — but only if the Diamond
  //  on the fork actually has the facet for the selector in that data.
  // ─────────────────────────────────────────────────────────────────────────
  const transactionHash = await currentClient.writeContract({
    address: EXECUTOR_CONTRACT,
    abi: RESCUE_EXECUTOR_ABI,
    functionName: "executeRescue",
    args: [
      AAVE_USER,
      OP_WETH,
      BigInt("8500000000000"),
      (contractCallQuote.transactionRequest?.data ?? "0x") as `0x${string}`,
    ],
  });
  
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
  console.log(
    "\n",
    "=".repeat(10),
    "Balance of",
    ETH_WHALE.address,
    "=".repeat(10),
  );
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

// Run main
main().catch(console.error);