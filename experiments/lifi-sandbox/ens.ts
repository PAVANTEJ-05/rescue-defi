import { addEnsContracts } from '@ensdomains/ensjs'
import { setRecords } from '@ensdomains/ensjs/wallet'
import { createWalletClient, custom,http } from 'viem'
import { mainnet } from 'viem/chains'
 
const wallet = createWalletClient({
  chain: addEnsContracts(mainnet),
  transport: http('https://rpc.buildbear.io/vivacious-gamora-5947d622'),
})
const hash = await setRecords(wallet, {
  name: 'ens.eth',
  coins: [
    {
      coin: 'ETH',
      value: '0xFe89cc7aBB2C4183683ab71653C4cdc9B02D44b7',
    },
  ],
  texts: [{ key: 'foo', value: 'bar' }],
  resolverAddress: '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41',
})