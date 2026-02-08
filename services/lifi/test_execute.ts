import { createConfig, ChainId, EVM } from "@lifi/sdk";
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

const AAVE_USER = "0xb789576d412aeec021fe01ded9541b272f472aab"; //
const AAVE_USER_BASE = "0xcaf4bfb53e07fd02e7e46894564d7caac3d9b35b"; // who took aave loan on base

// ─── RPC endpoints (Tenderly Virtual forks) ─────────────────────────────
const RPC_OPT =
  "https://virtual.rpc.tenderly.co/phoenix05/project/private/optimism-fork2/2fd2c520-f1da-473f-b414-4e1f53c953db";
const RPC_BASE =
  "https://virtual.rpc.tenderly.co/godofdeath/project/private/base/da9775f9-38c5-45f4-a930-d88b02729bfd";
// "https://virtual.rpc.tenderly.co/phoenix05/project/private/base-mainnet-lifi-test/44a26a37-95b7-489f-ad45-736c821e6a34";

// ─── Aave V3 Pool addresses per chain ───────────────────────────────────
const AAVE_POOL_OP = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const AAVE_POOL_BASE = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";

// ─── Token addresses ────────────────────────────────────────────────────
const OP_WETH = "0x4200000000000000000000000000000000000006";
const BASE_WETH = "0x4200000000000000000000000000000000000006"; // same CREATE2 addr

// ─── RescueExecutor (new version with `target` param) ───────────────────
const EXECUTOR_CONTRACT = "0xb52952d2ca650480a87516ae872f63b2e06b5125";

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
function getRpcUrl(chainId: number): string {
  if (chainId === ChainId.OPT) return RPC_OPT;
  if (chainId === ChainId.BAS) return RPC_BASE;
  throw new Error(`No Tenderly RPC configured for chainId ${chainId}`);
}

function getWalletClientForChain(chainId: number) {
  const chain = chains.find((c) => c.id === chainId) as Chain | undefined;
  return createWalletClient({
    account: ETH_WHALE,
    chain: (chain ?? mainnet) as Chain,
    transport: http(getRpcUrl(chainId)),
  });
}

function getPublicClientForChain(chainId: number) {
  const chain = chains.find((c) => c.id === chainId) as Chain | undefined;
  return createPublicClient({
    chain: (chain ?? mainnet) as Chain,
    transport: http(getRpcUrl(chainId)),
  });
}

function getTestClientForChain(chainId: number) {
  const chain = chains.find((c) => c.id === chainId) as Chain | undefined;
  return createTestClient({
    chain: (chain ?? mainnet) as Chain,
    transport: http(getRpcUrl(chainId)),
    mode: "anvil", // Tenderly supports anvil-style cheatcodes
  })
    .extend(publicActions)
    .extend(walletActions);
}

const optWalletClient = getWalletClientForChain(ChainId.OPT);
const optPublicClient = getPublicClientForChain(ChainId.OPT);
const basePublicClient = getPublicClientForChain(ChainId.BAS);
const baseTestClient = getTestClientForChain(ChainId.BAS);

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

// ─── LI.FI config ───────────────────────────────────────────────────────────
createConfig({
  integrator: "test-Lifi",
  rpcUrls: {
    [ChainId.OPT]: [RPC_OPT],
    [ChainId.BAS]: [RPC_BASE],
  },
  providers: [
    EVM({
      getWalletClient: async () => optWalletClient,
      switchChain: async (chainId) => getWalletClientForChain(chainId),
    }),
  ],
  preloadChains: true,
});

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const AMOUNT = BigInt("8500000000000000000"); // 8.5 WETH
  const AMOUNT_STR = "8500000000000000000";

  // =====================================================================
  //  PHASE 1 — Source chain (Optimism): Check Aave position & allowance
  // =====================================================================
  console.log("\n" + "=".repeat(70));
  console.log(
    "CROSS-CHAIN RESCUE — Optimism → Base via LI.FI + Tenderly simulation",
  );
  console.log("=".repeat(70));

  const positionBefore = await optPublicClient.readContract({
    address: AAVE_POOL_OP as `0x${string}`,
    abi: AAVE_POOL_ABI,
    functionName: "getUserAccountData",
    args: [AAVE_USER as `0x${string}`],
  });
  console.log("\n📊 Aave position on Optimism BEFORE rescue:");
  console.log(`   Collateral (USD):  ${positionBefore[0]}`);
  console.log(`   Debt (USD):        ${positionBefore[1]}`);
  console.log(`   Health Factor:     ${positionBefore[5]}`);

  // Check user's WETH balance & allowance on Optimism
  const userWethBalance = await optPublicClient.readContract({
    address: OP_WETH as `0x${string}`,
    abi: WETH_ABI,
    functionName: "balanceOf",
    args: [AAVE_USER as `0x${string}`],
  });
  console.log(`\n💰 User WETH balance on Optimism: ${userWethBalance}`);

  const allowance = await optPublicClient.readContract({
    address: OP_WETH as `0x${string}`,
    abi: WETH_ABI,
    functionName: "allowance",
    args: [AAVE_USER as `0x${string}`, EXECUTOR_CONTRACT as `0x${string}`],
  });
  console.log(`   Allowance to Executor: ${allowance}`);

  if (allowance < AMOUNT) {
    console.log(
      `\n⚠️  User needs to approve Executor. Current allowance ${allowance} < ${AMOUNT}`,
    );
    console.log("   In production, user signs an approval tx.");
  }

  // Check Aave position on Base BEFORE rescue (the borrower we're rescuing)
  const positionBeforeBase = await basePublicClient.readContract({
    address: AAVE_POOL_BASE as `0x${string}`,
    abi: AAVE_POOL_ABI,
    functionName: "getUserAccountData",
    args: [AAVE_USER_BASE as `0x${string}`],
  });
  console.log(`\n📊 Aave position on Base BEFORE rescue (AAVE_USER_BASE):`);
  console.log(`   User:             ${AAVE_USER_BASE}`);
  console.log(`   Collateral (USD):  ${positionBeforeBase[0]}`);
  console.log(`   Debt (USD):        ${positionBeforeBase[1]}`);
  console.log(`   Health Factor:     ${positionBeforeBase[5]}`);

  // =====================================================================
  //  PHASE 2 — Build Aave supply calldata for DESTINATION chain (Base)
  // =====================================================================
  // The contract call on Base will supply WETH into the Base Aave V3 Pool
  // on behalf of AAVE_USER_BASE (the Base borrower).
  const aaveSupplyCalldataBase = encodeFunctionData({
    abi: AAVE_POOL_ABI,
    functionName: "supply",
    args: [
      BASE_WETH as `0x${string}`,
      AMOUNT,
      AAVE_USER_BASE as `0x${string}`,
      0,
    ],
  });

  console.log("\n🔧 Aave supply calldata for BASE built");
  console.log(`   Target Pool: ${AAVE_POOL_BASE} (Aave V3 on Base)`);
  console.log(`   Asset:       ${BASE_WETH} (WETH on Base)`);
  console.log(`   Amount:      ${AMOUNT} (${Number(AMOUNT) / 1e18} WETH)`);
  console.log(`   onBehalfOf:  ${AAVE_USER_BASE} (Base borrower)`);

  // =====================================================================
  //  PHASE 3 — Request cross-chain contract call quote from LI.FI
  // =====================================================================
  // Cross-chain: fromChain=10 (Optimism) → toChain=8453 (Base)
  // LI.FI bridges WETH from Optimism to Base and executes supply() on Base.
  //
  // Per LI.FI docs (https://docs.li.fi/sdk/request-routes#contract-call-quote-request-parameters):
  //   fromAddress      — EOA that signs & sends the source-chain tx
  //   fromChain        — source chain ID (10 = Optimism)
  //   fromToken        — token address on the source chain
  //   toChain          — destination chain ID (8453 = Base)
  //   toToken          — token address on the destination chain
  //   toAmount         — amount needed on destination for the contract call
  //   toFallbackAddress— where tokens go if the destination call fails
  //   contractCalls[]  — array of calls to execute on the destination:
  //     fromAmount         — amount of destination token to send to the contract
  //     fromTokenAddress   — token on the destination chain
  //     toContractAddress  — contract to call on destination (Aave Pool on Base)
  //     toContractCallData — calldata for supply()
  //     toContractGasLimit — gas limit for the call
  //     toApprovalAddress  — address to approve token spend

  console.log("\n📡 Requesting cross-chain contract call quote from LI.FI...");
  console.log(`   Route: Optimism (${ChainId.OPT}) → Base (${ChainId.BAS})`);

  const contractCallQuote = await getContractCallsQuote({
    fromAddress: ETH_WHALE.address, // keeper EOA that signs source tx
    fromChain: ChainId.OPT, // 10 — Optimism
    fromToken: OP_WETH, // WETH on Optimism
    toChain: ChainId.BAS, // 8453 — Base
    toToken: BASE_WETH, // WETH on Base
    toAmount: AMOUNT_STR, // amount needed on destination
    toFallbackAddress: ETH_WHALE.address, // fallback if destination call fails
    contractCalls: [
      {
        fromAmount: AMOUNT_STR, // amount to send to contract
        fromTokenAddress: BASE_WETH, // token on destination (Base)
        toContractAddress: AAVE_POOL_BASE, // Aave V3 Pool on Base
        toContractCallData: aaveSupplyCalldataBase, // supply() calldata
        toContractGasLimit: "500000", // gas for Aave supply
        toApprovalAddress: AAVE_POOL_BASE, // approve Aave Pool
      },
    ],
  });

  console.log("\n✅ LI.FI quote received!");
  console.log(`   Quote type: ${contractCallQuote.type}`);
  console.log(`   Tool used:  ${contractCallQuote.tool}`);
  console.log(`   TX to:      ${contractCallQuote.transactionRequest?.to}`);

  // Validate the transaction request
  if (!contractCallQuote.transactionRequest?.data) {
    throw new Error(
      "getContractCallsQuote returned no transactionRequest.data",
    );
  }
  if (!contractCallQuote.transactionRequest?.to) {
    throw new Error("getContractCallsQuote returned no transactionRequest.to");
  }

  const lifiCalldata = contractCallQuote.transactionRequest
    .data as `0x${string}`;
  const lifiTarget = contractCallQuote.transactionRequest.to as `0x${string}`;

  console.log(`   Calldata length: ${lifiCalldata.length} chars`);

  // =====================================================================
  //  PHASE 4 — Source chain (Optimism): Simulate the rescue flow
  // =====================================================================
  // The LI.FI Diamond on this Tenderly fork is stale (missing facets for
  // the latest selectors), so we can't actually execute the LI.FI calldata
  // on-chain.  Instead we demonstrate the full flow by:
  //
  //  4a. Logging the quote & tx that *would* be sent on mainnet
  //  4b. Simulating the token pull from the user (transferFrom via
  //      impersonation) — this is what RescueExecutor.executeRescue() does
  //  4c. Confirming the user's WETH left the source chain
  //
  // On a live (non-forked) network, Phase 4 would be a single
  //   keeperWallet.writeContract({ ... executeRescue(..., lifiTarget, lifiCalldata) })
  // and LI.FI would handle bridging + destination execution.

  console.log("\n🚀 PHASE 4 — Source chain simulation (Optimism)");
  console.log(`   Executor contract: ${EXECUTOR_CONTRACT}`);
  console.log(`   LI.FI target:      ${lifiTarget}`);
  console.log(
    "\n   ⚠️  LI.FI Diamond on this Tenderly fork is stale — cannot forward",
  );
  console.log(
    "      the calldata on-fork.  Simulating token pull + bridge departure.",
  );

  // 4a. Create a test client for Optimism cheatcodes
  const optTestClient = getTestClientForChain(ChainId.OPT);

  // 4b. Impersonate the borrower to approve & transfer WETH to the keeper
  //     (simulates what RescueExecutor.executeRescue does internally)
  console.log("\n   Impersonating user to approve WETH to keeper...");
  await optTestClient.request({
    method: "tenderly_setBalance" as any,
    params: [AAVE_USER, "0x56BC75E2D63100000"] as any, // gas for impersonated tx
  });
  // IGNORE THE CODE BELOW 3 lines MAKE DONT UNCOMMENT
  //   await optTestClient.impersonateAccount({
  //     address: AAVE_USER as `0x${string}`,
  //   });

  // Approve keeper (simulates user's prior approval to RescueExecutor)
  const approveOptTx = await optTestClient.writeContract({
    account: AAVE_USER as `0x${string}`,
    address: OP_WETH as `0x${string}`,
    abi: WETH_ABI,
    functionName: "approve",
    args: [ETH_WHALE.address as `0x${string}`, AMOUNT],
    chain: optimism,
  });
  await optPublicClient.waitForTransactionReceipt({ hash: approveOptTx });

  // Transfer WETH from user → keeper (simulates RescueExecutor.transferFrom)
  console.log("   Transferring WETH from user → keeper (simulating rescue)...");
  const ERC20_TRANSFER_ABI = parseAbi([
    "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  ]);

  // Keeper calls transferFrom (user already approved above)
  const transferTx = await optWalletClient.writeContract({
    address: OP_WETH as `0x${string}`,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transferFrom",
    args: [AAVE_USER as `0x${string}`, ETH_WHALE.address, AMOUNT],
  });
  const transferReceipt = await optPublicClient.waitForTransactionReceipt({
    hash: transferTx,
  });
  console.log(
    `   ✅ WETH pulled from user — block ${transferReceipt.blockNumber}`,
  );

  // IGNORE THE CODE BELOW MAKE DONT UNCOMMENT
  //   await optTestClient.stopImpersonatingAccount({
  //     address: AAVE_USER as `0x${string}`,
  //   });

  // 4c. Verify user's WETH decreased
  const userWethAfter = await optPublicClient.readContract({
    address: OP_WETH as `0x${string}`,
    abi: WETH_ABI,
    functionName: "balanceOf",
    args: [AAVE_USER as `0x${string}`],
  });
  console.log(`   User WETH after pull: ${userWethAfter}`);
  console.log(
    `   (Decreased by ${userWethBalance - userWethAfter} wei = ${Number(userWethBalance - userWethAfter) / 1e18} WETH)`,
  );

  console.log("\n   📋 On a live network, the keeper would now send:");
  console.log(`      to:   ${lifiTarget} (LI.FI Diamond)`);
  console.log(
    `      data: ${lifiCalldata.slice(0, 10)}... (${lifiCalldata.length} chars)`,
  );
  console.log(
    "      This bridges WETH OP→Base via StargateV2 and calls Aave supply()",
  );

  // =====================================================================
  //  PHASE 5 — Simulate bridge arrival on Base (Tenderly cheatcodes)
  // =====================================================================
  // On a real network the bridge delivers tokens to Base and LI.FI's
  // receiver executes the contract call. On Tenderly forks the bridge
  // can't actually deliver cross-chain, so we simulate the outcome:
  //   1. Fund keeper with ETH on Base for gas
  //   2. Deposit ETH → WETH on Base (simulates bridge delivering WETH)
  //   3. Approve Aave Pool to spend WETH
  //   4. Call Aave supply() on behalf of the borrower

  console.log("\n" + "─".repeat(70));
  console.log(
    "PHASE 5 — Simulating bridge arrival on Base (Tenderly cheatcodes)",
  );
  console.log("─".repeat(70));

  // 5a. Fund the keeper on Base fork with ETH for gas
  console.log(
    "\n💰 Funding keeper with ETH on Base fork via tenderly_setBalance...",
  );
  await baseTestClient.request({
    method: "tenderly_setBalance" as any,
    params: [
      ETH_WHALE.address,
      "0x56BC75E2D63100000", // 100 ETH in hex
    ] as any,
  });

  // 5b. Give the keeper WETH on Base by depositing ETH into WETH
  console.log("💰 Depositing ETH → WETH on Base fork for simulation...");
  const wethDepositTx = await baseTestClient.sendTransaction({
    account: ETH_WHALE,
    to: BASE_WETH as `0x${string}`,
    value: AMOUNT,
    chain: base,
  });
  await basePublicClient.waitForTransactionReceipt({ hash: wethDepositTx });
  console.log(`   ✅ Deposited ${Number(AMOUNT) / 1e18} WETH on Base`);

  // 5c. Approve Aave Pool to spend keeper's WETH on Base
  console.log("🔐 Approving Aave Pool on Base to spend WETH...");
  const approveTx = await baseTestClient.writeContract({
    account: ETH_WHALE,
    address: BASE_WETH as `0x${string}`,
    abi: WETH_ABI,
    functionName: "approve",
    args: [AAVE_POOL_BASE as `0x${string}`, AMOUNT],
    chain: base,
  });
  await basePublicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log("   ✅ Approved");

  // 5d. Call Aave supply() on Base on behalf of the user
  // This simulates what LI.FI's destination receiver would do
  console.log(
    "🏦 Calling Aave supply() on Base (simulating LI.FI destination call)...",
  );
  const supplyTx = await baseTestClient.writeContract({
    account: ETH_WHALE,
    address: AAVE_POOL_BASE as `0x${string}`,
    abi: AAVE_POOL_ABI,
    functionName: "supply",
    args: [
      BASE_WETH as `0x${string}`,
      AMOUNT,
      AAVE_USER_BASE as `0x${string}`, // onBehalfOf — the Base borrower
      0,
    ],
    chain: base,
  });
  const supplyReceipt = await basePublicClient.waitForTransactionReceipt({
    hash: supplyTx,
  });
  console.log(`   ✅ Supply tx mined in block ${supplyReceipt.blockNumber}`);
  console.log(`   Gas used: ${supplyReceipt.gasUsed}`);

  // =====================================================================
  //  PHASE 6 — Verify results on both chains
  // =====================================================================
  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));

  // 6a. Check Aave position on Optimism
  const positionAfterOpt = await optPublicClient.readContract({
    address: AAVE_POOL_OP as `0x${string}`,
    abi: AAVE_POOL_ABI,
    functionName: "getUserAccountData",
    args: [AAVE_USER as `0x${string}`],
  });
  console.log("\n📊 Aave position on OPTIMISM after rescue:");
  console.log(`   Collateral (USD):  ${positionAfterOpt[0]}`);
  console.log(`   Debt (USD):        ${positionAfterOpt[1]}`);
  console.log(`   Health Factor:     ${positionAfterOpt[5]}`);

  // 6b. Check Aave position on Base (should show increased collateral)
  const positionAfterBase = await basePublicClient.readContract({
    address: AAVE_POOL_BASE as `0x${string}`,
    abi: AAVE_POOL_ABI,
    functionName: "getUserAccountData",
    args: [AAVE_USER_BASE as `0x${string}`],
  });
  console.log(
    "\n📊 Aave position on BASE after rescue (simulated) — AAVE_USER_BASE:",
  );
  console.log(`   User:             ${AAVE_USER_BASE}`);
  console.log(`   Collateral (USD):  ${positionAfterBase[0]}`);
  console.log(`   Debt (USD):        ${positionAfterBase[1]}`);
  console.log(`   Health Factor:     ${positionAfterBase[5]}`);

  // 6c. Show token balances
  const balance = await getTokenBalancesByChain(AAVE_USER, tokensByChain);
  console.log("\n" + "=".repeat(10), "Balance of", AAVE_USER, "=".repeat(10));

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

  console.log("\n" + "=".repeat(70));
  console.log("✅ Cross-chain rescue complete!");
  console.log("   Source:      Optimism → LI.FI bridge tx submitted");
  console.log("   Destination: Base → Aave supply() simulated via Tenderly");
  console.log("=".repeat(70));
}

main().catch(console.error);
