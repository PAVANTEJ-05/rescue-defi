export {};
import {
  createConfig,
  ChainId,
  EVM,
} from "@lifi/sdk";
import {
  createWalletClient,
  createTestClient,
  createPublicClient,
  http,
  encodeFunctionData,
  type Chain,
  publicActions,
  walletActions,
  parseAbi,
} from "viem";

import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, mainnet, optimism, polygon, base } from "viem/chains";
import { getContractCallsQuote, getTokenBalancesByChain } from "@lifi/sdk";

// ─── Account & Constants ────────────────────────────────────────────────────
const ETH_WHALE = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const chains = [arbitrum, mainnet, optimism, polygon, base];

const AAVE_USER = "0xb789576d412aeec021fe01ded9541b272f472aab";

const RPC_OPT =
  "https://virtual.rpc.tenderly.co/phoenix05/project/private/optimism-fork2/2fd2c520-f1da-473f-b414-4e1f53c953db";
const AAVE_POOL_ADDRESS = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const OP_WETH = "0x4200000000000000000000000000000000000006";

// TODO: Update this after redeploying the new RescueExecutor contract
const EXECUTOR_CONTRACT = "0x825794255ae3960f62de3fc3e0e94ee2a4887f73";

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
      chainId: 10,
      address: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      name: "op",
      decimals: 18,
      priceUSD: "2222.33",
    },
  ],
};

// ─── Client helpers ─────────────────────────────────────────────────────────
function getWalletClientForChain(chainId: number) {
  const chain = chains.find((c) => c.id === chainId) as Chain | undefined;
  const transport =
    chainId === ChainId.OPT ? http(RPC_OPT) : http();
  return createWalletClient({
    account: ETH_WHALE,
    chain: (chain ?? mainnet) as Chain,
    transport,
  });
}

function getPublicClientForChain(chainId: number) {
  const transport =
    chainId === ChainId.OPT ? http(RPC_OPT) : http();
  return createPublicClient({
    chain: chainId === ChainId.OPT ? optimism : mainnet,
    transport,
  });
}

const mainnetWalletClient = getWalletClientForChain(ChainId.OPT);
const mainnetPublicClient = getPublicClientForChain(ChainId.OPT);

// ─── ABIs ───────────────────────────────────────────────────────────────────
const AAVE_POOL_ABI = parseAbi([
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
]);

const RESCUE_EXECUTOR_ABI = parseAbi([
  "constructor(address _keeper, uint256 _cooldownSeconds)",
  "error OnlyKeeper()",
  "error CooldownActive(uint256 remaining)",
  "error InvalidTarget()",
  "error ERC20TransferFailed()",
  "error ERC20ApproveFailed()",
  "error CallFailed()",
  "event RescueExecuted(address indexed user, address indexed tokenIn, uint256 amountIn, address target, uint256 timestamp)",
  "function keeper() view returns (address)",
  "function COOLDOWN_SECONDS() view returns (uint256)",
  "function lastRescueAt(address user) view returns (uint256)",
  "function executeRescue(address user, address tokenIn, uint256 amountIn, address target, bytes callData) external payable",
  "receive() external payable",
]);

const WETH_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// ─── LI.FI config (kept for future cross-chain use) ────────────────────────
createConfig({
  integrator: "test-Lifi",
  rpcUrls: {
    [ChainId.ETH]: [],
    [ChainId.BAS]: [
      "https://virtual.rpc.tenderly.co/phoenix05/project/private/base-mainnet-lifi-test/44a26a37-95b7-489f-ad45-736c821e6a34",
    ],
    [ChainId.OPT]: [RPC_OPT],
  },
  providers: [
    EVM({
      getWalletClient: async () => mainnetWalletClient,
      switchChain: async (chainId) => getWalletClientForChain(chainId),
    }),
  ],
  preloadChains: true,
});

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const publicClient = getPublicClientForChain(ChainId.OPT);
  const keeperWallet = getWalletClientForChain(ChainId.OPT);
  const AMOUNT = BigInt("8500000000000000000"); // 8.5 WETH

  // ─── Step 1: Check Aave position BEFORE ───────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("RESCUE EXECUTION — Direct Aave supply via RescueExecutor");
  console.log("=".repeat(60));

  const positionBefore = await publicClient.readContract({
    address: AAVE_POOL_ADDRESS,
    abi: AAVE_POOL_ABI,
    functionName: "getUserAccountData",
    args: [AAVE_USER],
  });
  console.log("\n📊 Aave position BEFORE rescue:");
  console.log(`   Collateral (USD):  ${positionBefore[0]}`);
  console.log(`   Debt (USD):        ${positionBefore[1]}`);
  console.log(`   Health Factor:     ${positionBefore[5]}`);

  // ─── Step 2: Check user's WETH balance & allowance ────────────────────
  const userWethBalance = await publicClient.readContract({
    address: OP_WETH,
    abi: WETH_ABI,
    functionName: "balanceOf",
    args: [AAVE_USER],
  });
  console.log(`\n💰 User WETH balance: ${userWethBalance}`);

  const allowance = await publicClient.readContract({
    address: OP_WETH,
    abi: WETH_ABI,
    functionName: "allowance",
    args: [AAVE_USER, EXECUTOR_CONTRACT],
  });
  console.log(`   Allowance to Executor: ${allowance}`);

  if (allowance < AMOUNT) {
    console.log(
      `\n⚠️  User needs to approve Executor. Current allowance ${allowance} < ${AMOUNT}`,
    );
    console.log(
      "   In production, user signs an approval tx. For testing, impersonate:",
    );
    // You'll need to impersonate the user on Tenderly to set the approval
    // await testClient.impersonateAccount({ address: AAVE_USER });
    // then call approve(EXECUTOR_CONTRACT, AMOUNT) as AAVE_USER
  }

  // ─── Step 3: Build Aave supply calldata ───────────────────────────────
  const aaveSupplyCalldata = encodeFunctionData({
    abi: AAVE_POOL_ABI,
    functionName: "supply",
    args: [OP_WETH, AMOUNT, AAVE_USER, 0],
  });

  console.log("\n🔧 Aave supply calldata built");
  console.log(`   Target: ${AAVE_POOL_ADDRESS}`);
  console.log(`   Asset:  ${OP_WETH}`);
  console.log(`   Amount: ${AMOUNT} (${Number(AMOUNT) / 1e18} WETH)`);

  // ─── Step 4: Call executeRescue on the RescueExecutor ─────────────────
  // The new contract accepts `target` as a parameter, so we pass the
  // Aave Pool address directly. No LiFi Diamond involved.
  console.log("\n🚀 Sending executeRescue transaction...");

  const txHash = await keeperWallet.writeContract({
    address: EXECUTOR_CONTRACT,
    abi: RESCUE_EXECUTOR_ABI,
    functionName: "executeRescue",
    args: [
      AAVE_USER,       // user
      OP_WETH,         // tokenIn
      AMOUNT,          // amountIn
      AAVE_POOL_ADDRESS, // target — Aave Pool directly!
      aaveSupplyCalldata, // callData for supply()
    ],
  });

  console.log(`   Tx hash: ${txHash}`);
  console.log("   Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  console.log(`   ✅ Mined in block ${receipt.blockNumber}`);
  console.log(`   Gas used: ${receipt.gasUsed}`);

  // ─── Step 5: Check Aave position AFTER ────────────────────────────────
  const positionAfter = await publicClient.readContract({
    address: AAVE_POOL_ADDRESS,
    abi: AAVE_POOL_ABI,
    functionName: "getUserAccountData",
    args: [AAVE_USER],
  });
  console.log("\n📊 Aave position AFTER rescue:");
  console.log(`   Collateral (USD):  ${positionAfter[0]}`);
  console.log(`   Debt (USD):        ${positionAfter[1]}`);
  console.log(`   Health Factor:     ${positionAfter[5]}`);

  const collateralDiff = positionAfter[0] - positionBefore[0];
  const hfDiff = positionAfter[5] - positionBefore[5];
  console.log(`\n📈 Collateral increased by: ${collateralDiff} (USD base units)`);
  console.log(`   Health Factor improved by: ${hfDiff}`);

  // ─── Step 6: Show token balances ──────────────────────────────────────
  const balance = await getTokenBalancesByChain(AAVE_USER, tokensByChain);
  console.log(
    "\n" + "=".repeat(10),
    "Balance of",
    AAVE_USER,
    "=".repeat(10),
  );

  function formatAmount(amount: bigint, decimals: number) {
    const sign = amount < 0n ? "-" : "";
    const a = amount < 0n ? -amount : amount;
    const b = 10n ** BigInt(decimals);
    const integer = a / b;
    let fraction = (a % b).toString().padStart(decimals, "0");
    fraction = fraction.replace(/0+$/, "");
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

  // ─── Future: Cross-chain via LiFi ─────────────────────────────────────
  // When you recreate the Tenderly fork (fresh snapshot), you can use:
  //
  //   const contractCallQuote = await getContractCallsQuote({...});
  //   const lifiCalldata = contractCallQuote.transactionRequest?.data;
  //
  //   await keeperWallet.writeContract({
  //     address: EXECUTOR_CONTRACT,
  //     abi: RESCUE_EXECUTOR_ABI,
  //     functionName: "executeRescue",
  //     args: [
  //       AAVE_USER,
  //       OP_WETH,
  //       AMOUNT,
  //       "0x1231DEB6f5749ef6cE6943a275A1D3E7486F4EaE", // LiFi Diamond
  //       lifiCalldata,
  //     ],
  //   });
}

main().catch(console.error);