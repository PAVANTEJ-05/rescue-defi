import { addEnsContracts } from '@ensdomains/ensjs'
import { setRecords } from '@ensdomains/ensjs/wallet'
import { createWalletClient, createPublicClient, http, createTestClient } from 'viem'
import { privateKeyToAccount , } from 'viem/accounts'
import { normalize } from 'viem/ens'
import { mainnet,foundry } from 'viem/chains'


const transport = http('http://127.0.0.1:8546')
const publicClient = createPublicClient({
  chain: mainnet,
  transport,
})
const testClient = createTestClient({
  chain: mainnet,
  mode:'anvil',
  transport,
})

const ensAddress = await publicClient.getEnsAddress({
  name: normalize('nick.eth'),
})
console.log(ensAddress)
// const account = privateKeyToAccount()
if (!ensAddress) {
  throw new Error('ENS name nick.eth did not resolve to an address')
}
await testClient.impersonateAccount({ address: ensAddress })


const wallet = createWalletClient({
  account:ensAddress,
  chain: addEnsContracts(mainnet),
  transport,
})

const arr = [ { key: 'rescue.minHF', value: '1.2' },
    { key: 'rescue.targetHF', value: '1.5' },
    { key: 'rescue.maxAmount', value: '1.2' },
    { key: 'rescue.cooldown', value: '500' }]

const hash = await setRecords(wallet, {
  name: 'nick.eth',
  account: ensAddress,
  texts: arr,
  resolverAddress: '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41',
})

console.log(hash)



for (const {key} of arr){
  
const ensText = await publicClient.getEnsText({
  name: normalize('nick.eth'),
  key,
})
console.log(key,":",ensText)

}


