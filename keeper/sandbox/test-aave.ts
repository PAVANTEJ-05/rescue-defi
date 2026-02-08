/**
 * Quick test to verify Aave data fetching works
 */
import { JsonRpcProvider } from 'ethers';
import { getUserAccountData } from '../aave/monitor.js';
import { getChainConfig } from '../config/chains.js';

const RPC_URL = process.env['RPC_URL'] || 'https://virtual.rpc.tenderly.co/godofdeath/project/private/opm/05b55647-3026-437b-b35d-024f0725fae6';
const CHAIN_ID = parseInt(process.env['CHAIN_ID'] || '10', 10);
const USER = '0xb87e30d0351dc5770541b3233e13c8cf810b287b';

async function test() {
  console.log('='.repeat(60));
  console.log('Testing Aave Data Fetch');
  console.log('='.repeat(60));
  
  const chainConfig = getChainConfig(CHAIN_ID);
  console.log('Chain:', chainConfig.name);
  console.log('Aave Pool:', chainConfig.aavePool);
  console.log('User:', USER);
  console.log('RPC:', RPC_URL.slice(0, 50) + '...');
  console.log('');
  
  const provider = new JsonRpcProvider(RPC_URL);
  
  // Test provider connection
  try {
    const network = await provider.getNetwork();
    console.log('✅ Provider connected, chainId:', Number(network.chainId));
  } catch (e) {
    console.log('❌ Provider connection failed:', e);
    return;
  }
  
  // Test Aave data fetch
  console.log('');
  console.log('Fetching Aave user account data...');
  
  const data = await getUserAccountData(chainConfig.aavePool, USER, provider);
  
  if (data) {
    console.log('');
    console.log('✅ Aave data fetched successfully:');
    console.log('  Health Factor:', data.healthFactor.toFixed(4));
    console.log('  Collateral USD:', '$' + data.totalCollateralUSD.toFixed(2));
    console.log('  Debt USD:', '$' + data.totalDebtUSD.toFixed(2));
    console.log('  Liquidation Threshold:', (data.liquidationThreshold * 100).toFixed(2) + '%');
    
    if (data.totalDebtUSD > 0) {
      console.log('');
      console.log('Position status:');
      if (data.healthFactor < 1.0) {
        console.log('  ⚠️  LIQUIDATABLE (HF < 1.0)');
      } else if (data.healthFactor < 1.2) {
        console.log('  🟡 AT RISK (HF < 1.2)');
      } else {
        console.log('  🟢 HEALTHY');
      }
    } else {
      console.log('');
      console.log('  ℹ️  User has no debt');
    }
  } else {
    console.log('❌ Failed to fetch Aave data (returned null)');
  }
  
  console.log('');
  console.log('='.repeat(60));
}

test().catch(console.error);
