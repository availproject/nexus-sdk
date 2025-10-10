import { WalletClient } from 'viem';

import { equalFold, getAllowance, setAllowances, switchChain } from '../utils';
import { NetworkConfig, ChainListType } from '@nexus/commons';

class AllowanceQuery {
  constructor(
    private walletClient: WalletClient,
    private networkConfig: NetworkConfig,
    private chainList: ChainListType,
  ) {}

  async get(input: { chainID?: number; tokens?: string[] }) {
    const addresses = await this.walletClient.getAddresses();
    if (!addresses.length) {
      throw new Error('No account connected with wallet client');
    }
    const address = addresses[0];
    const tokens = input.tokens ?? ['USDT', 'USDC'];
    const chainID = input.chainID ? [input.chainID] : this.chainList.chains.map((c) => c.id);

    const inp = [];
    const out: Array<{
      allowance: bigint;
      chainID: number;
      token: string;
    }> = [];
    for (const c of chainID) {
      for (const t of tokens) {
        const token = this.chainList.getTokenInfoBySymbol(c, t);
        if (token) {
          const chain = this.chainList.getChainByID(c);
          if (!chain) {
            throw new Error('chain not supported');
          }
          inp.push(
            getAllowance(chain, address, token.contractAddress, this.chainList).then((val) => {
              out.push({
                allowance: val,
                chainID: c,
                token: t,
              });
            }),
          );
        }
      }
    }
    return Promise.all(inp).then(() => out);
  }

  async revoke(input: { chainID: number; tokens: string[] }) {
    await this.set({ ...input, amount: 0n });
  }

  async set(input: { amount: bigint; chainID: number; tokens: string[] }) {
    if (input.tokens == null) {
      throw new Error('missing token param');
    }

    if (input.amount == null) {
      throw new Error('missing amount param');
    }

    if (input.chainID == null) {
      throw new Error('missing chainID param');
    }

    const chain = this.chainList.getChainByID(input.chainID);
    if (!chain) {
      throw new Error('chain not supported');
    }

    let chainID = await this.walletClient.getChainId();
    if (input.chainID && input.chainID !== chainID) {
      await switchChain(this.walletClient, chain);
      chainID = input.chainID;
    }

    const tokenAddresses: Array<`0x${string}`> = [];
    for (const t of input.tokens) {
      const token = chain.custom.knownTokens.find((kt) => equalFold(kt.symbol, t));
      if (token) {
        tokenAddresses.push(token.contractAddress);
      }
    }

    if (!tokenAddresses.length) {
      throw new Error('None of the supplied token symbols are recognised on this chain');
    }

    await setAllowances(
      tokenAddresses,
      this.walletClient,
      this.networkConfig,
      this.chainList,
      chain,
      input.amount,
    );
  }
}

export { AllowanceQuery };
