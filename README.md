# Rescue.ETH

**Automated Liquidation Protection for Aave V3**

Rescue.ETH automatically supplies collateral to protect Aave positions from liquidation. It monitors health factors, reads user policies from ENS, and executes cross-chain rescues via LI.FI.

## Architecture

```
ENS (policy config)
    ↓
Node.js Keeper (decision-making, off-chain)
    ↓
LI.FI (cross-chain routing + execution)
    ↓
RescueExecutor (execution-only contract)
    ↓
AavePool.supply() (collateral supply)
```

## Key Principles

- **Supply-only**: We add collateral, never repay debt
- **User-funded**: User approves tokens, keeper executes
- **ENS-configured**: All policy lives in ENS text records
- **Minimal contract**: RescueExecutor is execution-only
- **LI.FI routing**: Cross-chain swaps handled by LI.FI

## Project Structure

```
rescue-eth/
├── contracts/
│   └── RescueExecutor.sol    # Production contract
├── keeper/
│   ├── index.ts              # Main loop
│   ├── aave/                 # Aave monitoring + math
│   ├── ens/                  # ENS config reader
│   ├── lifi/                 # LI.FI integration
│   ├── config/               # Types + defaults
│   └── utils/                # Logging + units
├── experiments/
│   └── lifi-sandbox/         # Experimental code
└── test/
```

## ENS Configuration

Users configure their rescue policy via ENS text records:

| Key | Description | Example |
|-----|-------------|---------|
| `rescue.minHF` | Health factor that triggers rescue | `1.2` |
| `rescue.targetHF` | Target health factor after rescue | `1.6` |
| `rescue.maxAmountUSD` | Max USD per rescue | `100` |
| `rescue.cooldownSeconds` | Min time between rescues | `10800` |
| `rescue.allowedTokens` | Tokens to use (comma-separated) | `USDC,ETH` |
| `rescue.allowedChains` | Chain IDs allowed | `1,10,8453` |

## Quick Start

### 1. Install Dependencies

```bash
cd keeper
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Run Keeper

```bash
npm run dev
```

## Contract Deployment

RescueExecutor requires:
- `keeper`: Address authorized to execute rescues
- `lifiRouter`: LI.FI Diamond address
- `cooldownSeconds`: Minimum time between rescues per user

## Health Factor Math

```
HF = (CollateralUSD × LiquidationThreshold) / DebtUSD

RequiredSupply = (targetHF × DebtUSD / LT) - CurrentCollateral
```

The keeper supplies exactly the minimum needed to reach `targetHF`, capped by `maxAmountUSD`.

## Security Model

- **Keeper**: Trusted but bounded by on-chain limits
- **Contract**: Only LI.FI router can be called
- **Cooldown**: Per-user rate limiting on-chain
- **Policy**: User-controlled via ENS

## License

MIT
