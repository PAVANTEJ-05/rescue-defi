import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { optimism } from "viem/chains";

const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

const walletClient = createWalletClient({
  account,
  chain: optimism,
  transport: http(
    "http://127.0.0.1:8545",
  ),
});

const publicOpClient = createPublicClient({
  chain: optimism,
  transport: http(
    "http://127.0.0.1:8545",
  ),
});

const RESCUE_EXECUTOR_ABI = parseAbi([
  // Constructor now only takes keeper + cooldown (no lifiRouter)
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

  // Now accepts target as a parameter
  "function executeRescue(address user, address tokenIn, uint256 amountIn, address target, bytes callData) external payable",

  "receive() external payable",
]);

// Deploy contract — only 2 constructor args now
const hash = await walletClient.deployContract({
  abi: RESCUE_EXECUTOR_ABI,
  bytecode: "0x...", // compile the new contract and paste bytecode here
  args: [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // keeper
    BigInt(120),                                      // cooldown seconds
  ],
});