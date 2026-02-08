# Sandbox — Demo & Test Scripts

These files are **NOT production code**. They are used for local fork testing,
Tenderly integration demos, and validating the LiFi + Aave flow.

## Files

| File | Purpose |
|------|---------|
| `test-aave.ts` | Quick Aave data fetch test (getUserAccountData) |
| `test-lifi-executor.ts` | Full RescueExecutor test via LiFi on forked Optimism |
| `test-newexecute.ts` | Legacy reference for the 4-param executeRescue flow |
| `demo-lifi-bridge.ts` | LiFi bridge + Aave supply demo (Mainnet → Base) |
| `demo-ens.ts` | ENS text record write/read demo (fork-only) |
| `deploy-executor.ts` | Deploy RescueExecutor to a local fork |
| `lifi-config.ts` | LiFi SDK config for fork/Tenderly environments |
| `lifi-simulate.ts` | Manual bridge arrival simulation for forks |
| `ens-writer.ts` | ENS record writer (fork impersonation) |

## Running

```bash
cd keeper
npx tsx sandbox/test-aave.ts
npx tsx sandbox/test-lifi-executor.ts
npx tsx sandbox/demo-ens.ts
```

## Prerequisites

- Anvil fork running on `127.0.0.1:8545`
- Tenderly virtual testnet (for bridge simulation)
- Test private key (Anvil default #0)
