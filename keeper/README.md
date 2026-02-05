# Rescue.ETH Keeper

Automated liquidation-protection keeper for Aave V3.

## Architecture

```
ENS (mainnet)     →  Keeper (off-chain)  →  LI.FI (routing)  →  RescueExecutor  →  Aave V3
  ↓                       ↓                      ↓                    ↓               ↓
 Policy Config       Decision Making        Token Routing       On-chain Safety    Collateral Supply
```

## Module Structure

```
keeper/
├── index.ts              # Main orchestration loop
├── config/
│   ├── types.ts          # TypeScript interfaces
│   ├── defaults.ts       # Default policy values
│   └── chains.ts         # Chain configs & addresses
├── aave/
│   ├── pool.ts           # Aave Pool contract factory
│   ├── monitor.ts        # Read user health factor
│   └── math.ts           # Compute required supply
├── ens/
│   ├── reader.ts         # Read raw ENS text records
│   └── parser.ts         # Parse & validate policy
├── lifi/
│   ├── quote.ts          # Fetch LI.FI routes
│   └── execute.ts        # Submit via RescueExecutor
└── utils/
    ├── logger.ts         # Structured logging
    └── units.ts          # Unit conversions (RAY, bps, etc.)
```

## Flow

1. **Monitor**: Read user's Aave health factor
2. **Policy**: Fetch rescue policy from ENS text records
3. **Decision**: If HF < minHF, compute required supply
4. **Route**: Get LI.FI quote for token bridging/swap
5. **Execute**: Submit transaction via RescueExecutor

## ENS Configuration

Users configure their rescue policy via ENS text records:

| Key | Description | Example |
|-----|-------------|---------|
| `rescue.minHF` | Trigger health factor | `1.3` |
| `rescue.targetHF` | Goal after rescue | `1.8` |
| `rescue.maxAmountUSD` | Max single rescue | `5000` |
| `rescue.allowedTokens` | Approved tokens | `USDC,USDT,DAI` |
| `rescue.allowedChains` | Approved chains | `1,42161,10` |
| `rescue.cooldownSeconds` | Min time between rescues | `3600` |

## Environment Variables

```bash
KEEPER_PRIVATE_KEY=0x...     # Required: Keeper wallet
EXECUTOR_ADDRESS=0x...       # Required: RescueExecutor contract
CHAIN_ID=1                   # Default: 1 (mainnet)
RPC_URL=https://...          # Optional: Override default RPC
POLL_INTERVAL_MS=60000       # Default: 60 seconds
DEMO_MODE=false              # Use defaults if ENS missing
```

## Running

```bash
cd keeper
npm install
npm run build
npm start
```

---

## ⚠️ KNOWN ARCHITECTURAL GAPS

### 1. Aave Supply Step Missing

**Problem**: LI.FI routes tokens between chains/dexes, but does NOT automatically supply them to Aave. After `executeRescue()` completes, tokens are in the user's wallet but NOT deposited as collateral.

**Solution Options**:
- A) Add `AavePool.supply()` call in `RescueExecutor.sol`
- B) Use LI.FI post-swap hooks (if available)
- C) Add second transaction step in keeper

### 2. Same-Chain Same-Token

**Problem**: Current code requests LI.FI quote even for same-chain same-token operations, which is unnecessary overhead and may fail.

**Solution**: Skip LI.FI for same-chain rescues, call `AavePool.supply()` directly.

### 3. User Discovery

**Problem**: `monitoredUsers` array is empty. Users must be manually added.

**Solution Options**:
- A) Event-based discovery (listen for `RescueConfigured` events)
- B) Registry contract where users register
- C) Off-chain database/API

### 4. Token Price Oracle

**Problem**: Code assumes all tokens = $1 (only valid for stablecoins).

**Solution**: Integrate price feed (Chainlink, Pyth, or LI.FI's price API).

---

## Development Status

- [x] Aave monitoring (read health factor)
- [x] ENS reading & parsing
- [x] LI.FI quote fetching
- [x] RescueExecutor integration
- [ ] **Aave supply step** ← CRITICAL
- [ ] User discovery mechanism
- [ ] Price oracle integration
- [ ] Multi-chain deployment
