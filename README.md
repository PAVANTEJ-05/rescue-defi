# Rescue.ETH

**Autonomous Liquidation-Prevention System for Aave V3**

Rescue.ETH is an off-chain keeper system that continuously monitors Aave V3 positions and proactively supplies collateral to prevent liquidation. Users configure their rescue policies via ENS text records. Cross-chain fund movement and Aave deposits are executed atomically through Li.Fi's `contractCallsQuote` API, routed through a minimal on-chain `RescueExecutor` contract.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Problem Statement](#2-problem-statement)
3. [Solution](#3-solution)
4. [High-Level Architecture](#4-high-level-architecture)
5. [Detailed End-to-End Workflow](#5-detailed-end-to-end-workflow)
6. [Smart Contract Architecture](#6-smart-contract-architecture)
7. [Node.js Keeper Design](#7-nodejs-keeper-design)
8. [ENS Usage](#8-ens-usage)
9. [Li.Fi Integration](#9-lifi-integration)
10. [Testing Strategy (Tenderly)](#10-testing-strategy-tenderly)
11. [Edge Cases & Safety Assumptions](#11-edge-cases--safety-assumptions)
12. [How to Run the Project Locally](#12-how-to-run-the-project-locally)
13. [Project Structure](#13-project-structure)
14. [Design Philosophy](#14-design-philosophy)
15. [Future Improvements / Roadmap](#15-future-improvements--roadmap)

---

## 1. Project Overview

### What Rescue.ETH Does

Rescue.ETH monitors Aave V3 lending positions and, when a user's health factor drops below a configured threshold, automatically supplies additional collateral to restore the position to safety — before liquidation occurs.

The system operates as a continuous off-chain loop (the "keeper") that:

1. Reads each user's position from Aave V3 on-chain.
2. Reads each user's rescue policy from ENS text records.
3. Computes the exact minimum collateral needed to reach the target health factor.
4. Routes tokens (same-chain or cross-chain) via Li.Fi and deposits them into Aave — all in a single atomic transaction.

### Why It Exists

DeFi borrowers face liquidation penalties of 5–10% when their health factor drops below 1.0. Manual monitoring is unreliable. Existing automation tools are either reactive (they liquidate, not prevent) or require complex on-chain infrastructure. Rescue.ETH shifts the paradigm from reactive liquidation to proactive prevention.

### Who It Is For

- DeFi borrowers with Aave V3 positions on Ethereum, Optimism, Arbitrum, or Base.
- Users with idle assets on other chains who want those assets to automatically protect their lending positions.
- Protocol integrators looking for a reference architecture for keeper-based liquidation protection.

---

## 2. Problem Statement

### Liquidation Risk

Aave V3 positions become eligible for liquidation when the health factor (HF) drops below 1.0. Liquidation is executed by third-party liquidators who receive a bonus (typically 5–10% of the liquidated collateral), meaning the borrower loses significantly more than the shortfall.

### Limitations of Manual Monitoring

- Humans cannot monitor positions 24/7.
- Market crashes happen in minutes; by the time a user reacts, the position may already be liquidated.
- Cross-chain positions add additional complexity — a user may have idle WETH on Optimism while their Aave position on Base is approaching liquidation.

### Why Existing Automation Is Insufficient

- **Chainlink Keepers / Automation**: On-chain automation introduces latency (block confirmation times), has gas constraints, and requires deploying additional on-chain logic. On-chain keepers are better suited as a fallback, not primary execution.
- **Liquidation bots**: These profit from liquidating users. They do not prevent liquidation.
- **Simple health-factor alerts**: Notifications require human action and introduce delay.

---

## 3. Solution

Rescue.ETH prevents liquidation by **proactively supplying collateral** before the health factor reaches 1.0.

Key design properties:

- **Proactive, not reactive**: The keeper triggers when HF drops below a user-defined threshold (e.g., 1.2), well above the liquidation boundary of 1.0.
- **Supply-only**: The system adds collateral to the position. It never repays debt or interacts with the user's borrow side.
- **User-funded**: The user pre-approves a `RescueExecutor` contract to pull tokens from their wallet. No keeper or protocol funds are at risk.
- **Minimum necessary supply**: The math module computes the exact collateral amount needed to reach the target HF. It never oversupplies.
- **Atomic execution**: Token pull → bridge → Aave supply happens in one transaction. If any step fails, the entire operation reverts and the user keeps their funds.

---

## 4. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        ENS (Mainnet)                             │
│  rescue.enabled=true | rescue.minHF=1.2 | rescue.maxAmount=10000│
└──────────────────────────┬───────────────────────────────────────┘
                           │ read policy
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Node.js Keeper (Off-Chain)                    │
│                                                                  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Aave   │  │   ENS    │  │  Supply  │  │    Li.Fi Quote   │ │
│  │ Monitor │→ │  Reader  │→ │   Math   │→ │     + Execute    │ │
│  └─────────┘  └──────────┘  └──────────┘  └────────┬─────────┘ │
└─────────────────────────────────────────────────────┼───────────┘
                                                      │ submit tx
                                                      ▼
┌──────────────────────────────────────────────────────────────────┐
│              RescueExecutor Contract (Source Chain)               │
│                                                                  │
│  transferFrom(user) → approve(lifiRouter) → lifiRouter.call()   │
│  → cleanup approval → verify zero residual balance              │
└──────────────────────────────────────────────────┬───────────────┘
                                                   │ bridge + call
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│              Li.Fi Diamond → Bridge → Destination Chain          │
│                                                                  │
│  AavePool.supply(token, amount, onBehalfOf=user, 0)             │
└──────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Role |
|---|---|
| **ENS** | Stores user rescue policy as text records on their ENS name. Enables configuration changes without contract redeployment. |
| **Node.js Keeper** | Off-chain process that polls Aave positions, reads ENS config, computes supply amounts, fetches Li.Fi quotes, and submits transactions. |
| **RescueExecutor** | Minimal Solidity contract that atomically pulls tokens from the user, approves the Li.Fi router, forwards calldata, and enforces invariants (cooldown, zero residual balance, keeper-only access). |
| **Li.Fi** | Aggregation protocol that handles same-chain swaps and cross-chain bridging + contract call execution via `contractCallsQuote`. |
| **Aave V3** | The lending protocol being protected. The keeper reads `getUserAccountData()` and the Li.Fi destination call invokes `AavePool.supply()`. |

---

## 5. Detailed End-to-End Workflow

### Step 1: Health Factor Monitoring

The keeper calls `AavePool.getUserAccountData(user)` on the target chain. Raw values are normalized:

- Collateral and debt are converted from Aave's base currency (8 decimals, USD) to standard numbers.
- Health factor is parsed from WAD (1e18). A derived HF is also computed from components: `HF = (Collateral × LiquidationThreshold) / Debt`. If the reported and derived values diverge by more than 3%, the derived value is used as the source of truth.

### Step 2: ENS Policy Resolution

The keeper reads the following text records from the user's ENS name (always via a mainnet provider):

- `rescue.enabled` — must be `"true"` for any rescue to execute.
- `rescue.minHF` — HF threshold that triggers a rescue.
- `rescue.targetHF` — target HF after the rescue.
- `rescue.maxAmount` — maximum USD per rescue.
- `rescue.cooldown` — minimum seconds between rescues.
- `rescue.allowedTokens` — comma-separated stablecoin symbols (e.g., `USDC,USDT,DAI`).
- `rescue.allowedChains` — comma-separated chain IDs.

If ENS records are missing, `DEFAULT_POLICY` is used (with `enabled: false`). The keeper never blocks on missing ENS configuration.

### Step 3: Risk Assessment

If `HF >= minHF`, the position is healthy — skip. If `HF < minHF`, the keeper computes the exact supply amount:

```
RequiredSupply = (targetHF × DebtUSD / LiquidationThreshold) - CurrentCollateralUSD
```

The result is capped by `maxAmountUSD`. If the capped amount would not restore HF ≥ minHF, the rescue is **rejected** to prevent infinite partial-rescue loops.

### Step 4: Pre-Flight Checks

Before submitting the transaction, the keeper verifies:

- The user's token balance is sufficient.
- The user has approved the `RescueExecutor` for at least the required amount.
- The cooldown period has likely passed (informational only — the contract is authoritative).

### Step 5: Li.Fi Quote

The keeper calls `getContractCallsQuote()` from the Li.Fi SDK. This returns a transaction request that, when executed on the source chain, will:

1. Bridge tokens to the destination chain (if cross-chain).
2. Execute `AavePool.supply(token, amount, onBehalfOf=user, 0)` on the destination chain.

The `fromAddress` in the quote is the `RescueExecutor` contract (since it holds the tokens after `transferFrom`).

### Step 6: Quote Target Validation

The `to` address in the Li.Fi quote is validated against a per-chain allowlist of trusted Li.Fi contracts (Diamond, Immutable Diamond, Executor, etc.). If the target is not in the allowlist, the rescue is aborted.

### Step 7: On-Chain Execution

The keeper calls `RescueExecutor.executeRescue(user, tokenIn, amountIn, callData)`:

1. **Pull**: `transferFrom(user, executor, amountIn)` — requires prior ERC20 approval.
2. **Approve**: `tokenIn.approve(lifiRouter, amountIn)` — exact amount, reset to 0 first.
3. **Forward**: `lifiRouter.call{value: msg.value}(callData)` — Li.Fi handles routing.
4. **Cleanup**: `tokenIn.approve(lifiRouter, 0)` — remove residual approval.
5. **Invariant**: `require(tokenIn.balanceOf(executor) == 0)` — executor must not retain funds.

### Step 8: Verification

If the transaction succeeds, the keeper logs a structured `RESCUE SUCCESSFUL` event with the transaction hash, chain, token, amount, and expected HF. If it fails, a structured error is logged with a parsed failure reason (approval, cooldown, LiFi call failure, etc.).

---

## 6. Smart Contract Architecture

### `RescueExecutor.sol`

A single, intentionally minimal contract deployed on the source chain.

**Design rationale**: The contract exists only to provide atomic execution guarantees that cannot be achieved purely off-chain. It contains no business logic for deciding *whether* to rescue — that lives entirely in the keeper.

#### Storage

| Variable | Type | Description |
|---|---|---|
| `keeper` | `address immutable` | Authorized keeper address. Set at construction. |
| `lifiRouter` | `address immutable` | Li.Fi Diamond address. Set at construction. |
| `COOLDOWN_SECONDS` | `uint256 immutable` | Per-user cooldown period. Set at construction. |
| `lastRescueAt` | `mapping(address => uint256)` | Last rescue timestamp per user. |

#### Function: `executeRescue`

```solidity
function executeRescue(
    address user,
    address tokenIn,
    uint256 amountIn,
    bytes calldata callData
) external payable onlyKeeper cooldownPassed(user)
```

**Execution flow**:

1. Verify `msg.sender == keeper`.
2. Verify cooldown has passed for `user`.
3. Update `lastRescueAt[user]` before external calls (reentrancy safe).
4. Pull tokens: `tokenIn.transferFrom(user, this, amountIn)`.
5. Approve Li.Fi router: reset to 0, then approve exact `amountIn`.
6. Forward calldata: `lifiRouter.call{value: msg.value}(callData)`.
7. Cleanup: remove approval, assert zero residual token balance.
8. Emit `RescueExecuted(user, tokenIn, amountIn, timestamp)`.

#### Security Properties

- **Keeper-only**: Only the immutable `keeper` address can call `executeRescue`.
- **Immutable router**: The `lifiRouter` is set at construction and cannot be changed. This prevents calldata from being forwarded to arbitrary addresses.
- **Cooldown enforcement**: Per-user cooldown prevents repeated drains.
- **Zero residual invariant**: The contract reverts if any tokens remain in the executor after execution. This guarantees the executor never accumulates user funds.
- **Atomic revert**: If `transferFrom`, `approve`, or the Li.Fi call fails, the entire transaction reverts. The user's tokens are never at risk.
- **No upgradeability**: The contract has no proxy pattern, no admin functions, and no storage slots that can be modified post-deployment.

#### Approval Model

Users must approve the `RescueExecutor` to spend their tokens **before** a rescue can execute. This is a one-time ERC20 `approve()` call per token. The keeper does not manage user approvals — it only checks allowance as a pre-flight validation.

---

## 7. Node.js Keeper Design

### Why Off-Chain

- **Speed**: The keeper can poll every 30 seconds, react sub-second to health factor changes, and submit transactions immediately. On-chain automation is bound by block times and gas limits.
- **Flexibility**: Policy parsing, math, quote freshness checks, and error classification are far simpler to implement and update off-chain.
- **Cost**: Off-chain monitoring is essentially free. On-chain keepers pay gas for every check, even when no action is needed.

### Entry Point (`index.ts`)

The keeper bootstraps by:

1. Loading and validating all environment variables (private key, executor address, chain ID, RPC URL, poll interval).
2. Initializing the Li.Fi SDK.
3. Setting up providers: one for the target chain, one for mainnet (ENS reads).
4. Validating provider connections and keeper wallet balance.
5. Loading the monitored user list.
6. Optionally loading cross-chain rescue configuration.
7. Starting the infinite monitoring loop.

### Monitoring Loop (`loop/runner.ts`)

A `while(true)` loop with precise timing:

```
while (!shutdownRequested) {
    tickStart = now()
    tick(context)          // process all users once
    elapsed = now() - tickStart
    sleep(pollInterval - elapsed)    // precise interval
}
```

Properties:
- No overlapping executions (sequential `await`).
- Precise timing: sleep duration is `interval - elapsed`, so tick execution time is subtracted.
- Graceful shutdown via `SIGINT`/`SIGTERM` handlers.
- Tick errors are caught and logged — the keeper never crashes on a single user's failure.

### Tick (`loop/tick.ts`)

One tick processes all monitored users sequentially. For each user:

1. Read ENS policy (with fallback to defaults).
2. Read Aave position data.
3. Log health status (always, for observability).
4. Check `policy.enabled === true` (explicit user consent required).
5. Validate policy integrity.
6. Check chain allowlist.
7. Check cooldown (informational — contract is authoritative).
8. Assess if rescue is needed (`HF < minHF`).
9. Compute supply amount with safety checks.
10. Select a stablecoin from the policy's allowed tokens.
11. Pre-check user's token balance and executor approval.
12. Fetch Li.Fi quote.
13. Validate quote target against trusted allowlist.
14. Execute rescue via `RescueExecutor`.
15. Log structured lifecycle event (success or failure with parsed error).

### Failure Handling

- **Per-user isolation**: Errors for one user do not affect processing of other users.
- **Structured error parsing**: Gas estimation failures are parsed for specific causes (approval, cooldown, keeper auth, Li.Fi call, residual balance, insufficient funds, nonce, timeout).
- **No crash guarantee**: Every code path in the execution module returns a structured `RescueResult`, never throws.

---

## 8. ENS Usage

### What Data Is Stored

| ENS Key | Type | Default | Bounds | Description |
|---|---|---|---|---|
| `rescue.enabled` | boolean | `false` | — | Must be `"true"` for any rescue. |
| `rescue.minHF` | number | `1.2` | [1.0, 2.0] | Health factor trigger threshold. |
| `rescue.targetHF` | number | `1.5` | [1.1, 3.0] | Target HF after rescue. Must be > minHF. |
| `rescue.maxAmount` | number | `10000` | [1, 100,000] | Max USD per rescue. |
| `rescue.cooldown` | number | `3600` | [60, 604800] | Seconds between rescues (1 min – 7 days). |
| `rescue.allowedTokens` | string | `USDC,USDT,DAI` | stablecoins only | Comma-separated token symbols. |
| `rescue.allowedChains` | string | `1,10,8453` | — | Comma-separated chain IDs. |

### Why ENS

- **Decentralized storage**: Configuration lives on-chain (Ethereum mainnet) and is censorship-resistant.
- **User-controlled**: Only the ENS name owner can modify records.
- **No redeployment**: Changing rescue parameters (thresholds, caps, allowed chains) requires only an ENS text record update — no contract interaction, no migration.
- **Standard tooling**: Users can set records via [app.ens.domains](https://app.ens.domains) or any ENS-compatible interface.
- **Upgradeability without proxies**: The keeper reads fresh policy values from ENS on every tick. If the user changes `rescue.maxAmount` from 5000 to 20000, the next tick uses the new value. No contract upgrade required.

### Consent Model

Rescue is disabled by default (`enabled: false`). A user must explicitly set `rescue.enabled=true` in their ENS records to opt in. The keeper checks this flag before any rescue execution.

---

## 9. Li.Fi Integration

### What Li.Fi Is Used For

Li.Fi is a multi-chain liquidity aggregation protocol. Rescue.ETH uses Li.Fi's `contractCallsQuote` API (not the standard `getQuote`/`getRoutes`) because it supports executing a **contract call after the bridge completes**.

This is critical: standard bridge operations only move tokens between chains. `contractCallsQuote` allows specifying a post-bridge call — in this case, `AavePool.supply()` — so the tokens are both bridged and deposited in a single logical operation.

### Why Approvals Are Not Manual Per Step

The `RescueExecutor` contract handles all approvals internally:

1. The user approves `RescueExecutor` once (per token).
2. `RescueExecutor` pulls tokens, approves the immutable `lifiRouter` for the exact amount, and forwards calldata.
3. Li.Fi's `contractCallsQuote` includes `toApprovalAddress` in the request, telling Li.Fi's destination receiver to approve the Aave pool before calling `supply()`.

No manual multi-step approval flow is required from the user.

### Atomic Execution

On the source chain, the entire flow (pull → approve → Li.Fi call) is atomic within `executeRescue()`. If any step fails, the transaction reverts.

On the destination chain, Li.Fi's receiver contract executes the `supply()` call. If the destination call fails, tokens are sent to `toFallbackAddress` (the keeper wallet), preventing permanent loss.

### Quote Freshness

Li.Fi quotes are fetched fresh before each rescue execution. Quotes are not cached across ticks. The keeper does not assume quote validity beyond the current execution.

---

## 10. Testing Strategy (Tenderly)

### How Tenderly Forks Are Used

The project uses Tenderly Virtual TestNets (forked environments) for end-to-end testing. The test scripts (`deploy.ts`, `execute.ts`) demonstrate the full rescue flow:

1. **Source chain (Optimism fork)**: Read Aave position, check balances, simulate token pull from user via impersonation, build Li.Fi quote.
2. **Destination chain (Base fork)**: Simulate bridge arrival using `tenderly_setBalance` cheatcodes, execute Aave `supply()` on behalf of the user, verify collateral increase.

### Known Limitations

- **Cross-chain bridge simulation**: Tenderly forks are isolated per chain. Real bridges cannot deliver tokens between forks. The test scripts simulate bridge arrival by minting tokens on the destination fork via cheatcodes.
- **Stale Li.Fi Diamond**: The Li.Fi Diamond contract on forked environments may lack recently deployed facets, causing `LiFiCallFailed` when forwarding calldata on-fork. The test scripts work around this by simulating the token pull and destination call separately.
- **TU usage**: Tenderly Virtual TestNets consume Transaction Units (TUs). Fork resets and repeated testing consume the TU allowance.

### Mitigations

- The test scripts separate the flow into phases (source chain simulation, destination chain simulation) so each phase can be validated independently.
- Li.Fi quotes are fetched from the live API (not forked), ensuring the routing logic and calldata encoding are exercised against real routing infrastructure.
- The `RescueExecutor` contract is deployed on forks and tested with real Aave Pool contracts (forked state), validating the actual on-chain execution path.

---

## 11. Edge Cases & Safety Assumptions

### Stale Quotes

Li.Fi quotes are fetched fresh per rescue. If market conditions change between quote and execution, the Li.Fi call may fail (slippage, insufficient liquidity). The transaction reverts atomically — the user keeps their tokens.

### Insufficient Liquidity

If Li.Fi cannot find a route (no bridge liquidity, DEX pool empty), `getContractCallsQuote` returns null. The keeper logs the failure and skips the user for this tick.

### Gas Spikes

The keeper estimates gas before submission and adds a 20% buffer. If gas estimation fails, the error is parsed and a structured failure reason is returned. The keeper does not retry automatically within the same tick.

### Partial Failures

If the capped supply amount (`maxAmountUSD`) is insufficient to restore HF ≥ minHF, the rescue is **rejected entirely**. This prevents infinite loops where small partial rescues never restore the position but continuously drain the user's funds.

### Double Execution

The `RescueExecutor` enforces a per-user cooldown (`COOLDOWN_SECONDS`) on-chain. Even if the keeper sends two transactions in rapid succession, the second one will revert with `CooldownActive`. The keeper also performs an informational cooldown check before submitting.

### ENS Misconfiguration

- Missing ENS records → `DEFAULT_POLICY` used (with `enabled: false`). No rescue executes.
- Invalid numeric values → clamped to bounds (e.g., `minHF` clamped to [1.0, 2.0]).
- `targetHF ≤ minHF` → `targetHF` is adjusted to `minHF + 0.3`.
- Non-stablecoin tokens in `allowedTokens` → silently filtered out at parse time. Only stablecoins (USDC, USDT, DAI, FRAX, LUSD, GUSD, USDP) are accepted.

### Revert Safety

Every external call in `executeRescue()` is checked:

- `transferFrom` failure → `ERC20TransferFailed` revert.
- `approve` failure → `ERC20ApproveFailed` revert.
- Li.Fi router call failure → `LiFiCallFailed` revert.
- Residual token balance → `ResidualBalance` revert.

In all cases, the transaction reverts atomically. The user's wallet state is unchanged.

---

## 12. How to Run the Project Locally

### Prerequisites

- Node.js ≥ 18.0.0
- npm or yarn
- A funded keeper wallet (private key with ETH for gas)
- RPC endpoints for the target chain and Ethereum mainnet (for ENS reads)
- A deployed `RescueExecutor` contract

### Environment Variables

Create a `.env` file in the `keeper/` directory:

```bash
# Required
KEEPER_PRIVATE_KEY=0x...                # 32-byte hex, keeper wallet private key
EXECUTOR_ADDRESS=0x...                  # Deployed RescueExecutor address

# Chain configuration
CHAIN_ID=10                             # Target chain (1=Mainnet, 10=Optimism, 8453=Base, 42161=Arbitrum)
RPC_URL=https://mainnet.optimism.io     # RPC for the target chain

# ENS (always mainnet)
MAINNET_RPC_URL=https://eth.llamarpc.com  # Mainnet RPC for ENS reads

# Monitoring
POLL_INTERVAL_MS=30000                  # Polling interval (min 1000ms)
LOG_LEVEL=INFO                          # DEBUG | INFO | WARN | ERROR

# Users to monitor (JSON array)
MONITORED_USERS='[{"address":"0x...","ensName":"user.eth"}]'

# Optional: Demo mode (uses default policy if ENS missing; does NOT bypass consent)
DEMO_MODE=false

# Optional: Force-enable override (NEVER use in production)
# RESCUE_FORCE_ENABLE=true

# Optional: Cross-chain rescue
# CROSS_CHAIN_ENABLED=true
# CROSS_CHAIN_DEST_CHAIN_ID=8453
# CROSS_CHAIN_SOURCE_TOKEN=0x4200000000000000000000000000000000000006
# CROSS_CHAIN_DEST_TOKEN=0x4200000000000000000000000000000000000006
# CROSS_CHAIN_AMOUNT=8500000000000000000
# CROSS_CHAIN_DEST_AAVE_POOL=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
```

### Install & Build

```bash
cd keeper
npm install
npm run build
```

### Start the Keeper

```bash
# Production
npm start

# Development (with hot reload)
npm run dev
```

### What Must Be Configured Before Running

1. A `RescueExecutor` contract must be deployed on the target chain with the keeper's wallet as the authorized `keeper` and the Li.Fi Diamond as `lifiRouter`.
2. Monitored users must have:
   - An Aave V3 position on the target chain.
   - `rescue.enabled=true` set in their ENS text records.
   - ERC20 approval granted to the `RescueExecutor` for the tokens they want to use for rescue.
3. The keeper wallet must hold ETH on the target chain for gas.

---

## 13. Project Structure

```
rescue-defi/
├── contracts/
│   └── RescueExecutor.sol        # On-chain execution contract (Solidity)
├── keeper/                        # Off-chain keeper (TypeScript / Node.js)
│   ├── index.ts                   # Bootstrap, config loading, entry point
│   ├── aave/
│   │   ├── pool.ts                # Aave V3 Pool ABI + contract factory
│   │   ├── monitor.ts             # Read & validate user health factor
│   │   └── math.ts                # Supply amount calculation + safety checks
│   ├── config/
│   │   ├── types.ts               # Core type definitions (RescuePolicy, AaveAccountData, etc.)
│   │   ├── defaults.ts            # Default policy, stablecoin list, Aave base currency config
│   │   └── chains.ts              # Chain configs, token addresses, trusted Li.Fi targets
│   ├── ens/
│   │   ├── reader.ts              # Read ENS text records via viem
│   │   ├── parser.ts              # Parse + validate raw strings into typed RescuePolicy
│   │   └── index.ts               # Module re-exports
│   ├── lifi/
│   │   ├── types.ts               # Li.Fi type definitions (ContractCallsQuoteRequest, etc.)
│   │   ├── quote.ts               # Build + fetch contractCallsQuote for Aave supply
│   │   ├── execute.ts             # Submit rescue tx via RescueExecutor contract
│   │   ├── crosschain-rescue.ts   # Cross-chain rescue quote builder (OP → Base pattern)
│   │   └── index.ts               # Module re-exports
│   ├── loop/
│   │   ├── tick.ts                # Single monitoring cycle (process all users once)
│   │   ├── runner.ts              # Infinite loop with precise timing + shutdown
│   │   └── index.ts               # Module re-exports
│   ├── utils/
│   │   ├── logger.ts              # Structured logging (module-scoped, level-gated)
│   │   └── units.ts               # Unit conversions (WAD, RAY, base currency, bps)
│   └── sandbox/                   # Development scripts, demos, experimental code
│       ├── demo-ens.ts            # ENS read/write demo
│       ├── demo-lifi-bridge.ts    # Li.Fi bridge demo
│       ├── deploy-executor.ts     # Contract deployment helper
│       ├── test-aave.ts           # Aave position reading test
│       └── ...
├── deploy.ts                      # End-to-end deployment + cross-chain rescue script
├── execute.ts                     # Full cross-chain rescue simulation (Tenderly forks)
└── README.md
```

### Module Responsibilities

| Module | Responsibility |
|---|---|
| `aave/` | Read-only interaction with Aave V3. Health factor monitoring, derived HF validation, supply amount math. No writes. |
| `ens/` | Read ENS text records from mainnet. Parse strings into typed policy objects. Validate bounds. Filter stablecoins. |
| `lifi/` | Build `contractCallsQuote` requests, fetch quotes, validate targets, execute rescues via `RescueExecutor`. |
| `loop/` | Timing and orchestration. `tick.ts` contains the decision logic. `runner.ts` is a pure timing loop. |
| `config/` | Static configuration: type definitions, default values, chain addresses, stablecoin registry. |
| `utils/` | Cross-cutting concerns: structured logging, unit conversions (WAD, RAY, bps, base currency). |

---

## 14. Design Philosophy

### Off-Chain Speed + On-Chain Safety

The keeper handles all decision-making off-chain — health factor monitoring, policy resolution, supply calculation, quote fetching, and pre-flight checks. This allows sub-minute response times with zero on-chain gas cost for monitoring.

The smart contract handles only what *must* be on-chain: atomic token pull, approval management, calldata forwarding, cooldown enforcement, and the zero-residual-balance invariant.

### Prevent Liquidation, Don't React to It

The system is designed around *prevention*, not *reaction*. The trigger threshold (`minHF`, default 1.2) fires well above the liquidation boundary (1.0). The target HF (`targetHF`, default 1.5) provides a comfortable buffer after rescue. The goal is that users protected by Rescue.ETH never experience a liquidation event.

### Minimal Contract Surface

The `RescueExecutor` has no admin functions, no upgradeability, no storage mutations beyond the cooldown mapping, and no business logic. This reduces audit surface and attack vectors. All complexity lives in the keeper, where it is easier to update and harder to exploit.

### User Sovereignty

- Users control their policy via ENS (no admin can override thresholds or caps).
- Users control their funds via ERC20 approvals (revoke approval = instantly disable rescue).
- The keeper cannot move funds without prior user approval.
- The `enabled` flag defaults to `false` — explicit opt-in required.

---

## 15. Future Improvements / Roadmap

### Fallback Automation

Integrate Chainlink Automation (or CRE) as a secondary execution path. If the off-chain keeper is down, an on-chain automation network can trigger the same `executeRescue()` function as a fallback. This is intentionally secondary to the keeper for latency and cost reasons.

### Multi-Protocol Support

Extend monitoring beyond Aave V3 to other lending protocols (Compound V3, Spark, Morpho). The supply math and monitor modules are protocol-specific and would need per-protocol implementations.

### Security Hardening

- Formal verification of the `RescueExecutor` contract.
- Independent audit of the keeper's decision logic, particularly the health factor validation and supply calculation.
- Rate limiting and anomaly detection in the keeper to detect unexpected behavior (e.g., rapid HF oscillation).

### User Discovery

Replace the static `MONITORED_USERS` list with dynamic discovery via:
- Scanning `Approval` events on the `RescueExecutor` contract.
- A registry contract where users can register/unregister.
- An off-chain API or database.

### Multi-Token Rescue

Support non-stablecoin rescue tokens by integrating a price oracle (Chainlink price feeds). Current architecture assumes stablecoin price = $1.00, which avoids oracle dependency but limits token selection.

### Repay Support

Extend the rescue strategy to include debt repayment (not just collateral supply) for cases where repayment is more capital-efficient. This would require interacting with Aave's `repay()` function and managing the repay token routing.

---

## Supported Chains

| Chain | ID | Aave V3 Pool | Li.Fi Diamond |
|---|---|---|---|
| Ethereum Mainnet | 1 | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Optimism | 10 | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Arbitrum One | 42161 | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Base | 8453 | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |

---

## License

MIT
