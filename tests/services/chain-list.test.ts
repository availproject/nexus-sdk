import { describe, expect, it } from 'vitest';
import { ZERO_ADDRESS } from '../../src/domain';
import { aggregateBalancesByCurrency } from '../../src/services/balances';
import { createChainList } from '../../src/services/chain-list';
import type { DeploymentResponse } from '../../src/domain/types/deployment-types';
import { makeUnifiedBalance } from '../helpers/balances';

const makeDeployment = (overrides?: Partial<DeploymentResponse>): DeploymentResponse => ({
  network: 'testnet',
  statekeeperUrl: 'https://statekeeper.example',
  fulfillmentBps: 0,
  mayanEnabled: false,
  mayanThresholdUsd: 0,
  mayanCancelRefundMaxPercentage: 0,
  chains: [
    {
      chainId: 1,
      universe: 'EVM',
      name: 'Ethereum',
      rpcUrl: 'https://rpc.example',
      vaultAddress: '0x0000000000000000000000000000000000000001',
      multicallAddress: '0x00000000000000000000000000000000000000aa',
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        logo: 'https://example.com/eth.png',
        currencyId: 3,
      },
      sponsored: false,
      swapSupported: true,
      tokens: [
        {
          symbol: 'USDC',
          name: 'USD Coin',
          address: '0x0000000000000000000000000000000000000003',
          decimals: 6,
          balanceSlot: 9,
          logo: 'https://example.com/usdc.png',
          permitVariant: 2,
          permitVersion: 1,
          currencyId: 1,
        },
      ],
      explorerUrl: 'https://etherscan.io',
      logo: 'https://example.com/chain.png',
    },
  ],
  ...overrides,
});

describe('createChainList', () => {
  it('threads currencyId, permitVariant, and permitVersion into knownTokens', () => {
    const chainList = createChainList(makeDeployment());
    const token = chainList.chains[0].custom.knownTokens[0];

    expect(token.currencyId).toBe(1);
    expect(token.permitVariant).toBe(2);
    expect(token.permitVersion).toBe(1);
  });

  it('threads currencyId into nativeCurrency and native token lookups', () => {
    const chainList = createChainList(makeDeployment());
    const chain = chainList.chains[0];

    expect(chain.nativeCurrency.currencyId).toBe(3);
    expect(chainList.getNativeToken(1).currencyId).toBe(3);
    expect(chainList.getTokenByAddress(1, ZERO_ADDRESS).currencyId).toBe(3);
    expect(chainList.getTokenInfoBySymbol(1, 'ETH').currencyId).toBe(3);
  });

  it('groups native and ERC20 bridge balances with the same currencyId', () => {
    const deployment = makeDeployment();
    const ethereum = deployment.chains[0];
    deployment.chains.push({
      ...ethereum,
      chainId: 5042,
      name: 'Arc',
      nativeCurrency: {
        ...ethereum.nativeCurrency,
        name: 'USD Coin',
        symbol: 'USDC',
        currencyId: 1,
      },
      tokens: [],
    });

    const balances = aggregateBalancesByCurrency(createChainList(deployment), [
      makeUnifiedBalance({
        chainId: 5042,
        tokenAddress: ZERO_ADDRESS,
        rawBalance: '1000000000000000000',
        value: '1',
      }),
      makeUnifiedBalance({
        chainId: 1,
        tokenAddress: ethereum.tokens[0].address,
        rawBalance: '2000000',
        value: '2',
      }),
    ]);

    expect(balances).toMatchObject([
      {
        currencyId: 1,
        balance: '3',
        chainBalances: [
          { chain: { id: 1 }, balance: '2', decimals: 6 },
          { chain: { id: 5042 }, balance: '1', decimals: 18 },
        ],
      },
    ]);
  });

  it('threads multicallAddress into the runtime chain', () => {
    const chainList = createChainList(makeDeployment());
    const chain = chainList.chains[0];

    expect(chain.multicallAddress).toBe('0x00000000000000000000000000000000000000aa');
  });

  describe('getTokenByCurrencyId', () => {
    it('returns token matching currencyId', () => {
      const chainList = createChainList(makeDeployment());
      const token = chainList.getTokenByCurrencyId(1, 1);

      expect(token).toBeDefined();
      expect(token!.symbol).toBe('USDC');
      expect(token!.currencyId).toBe(1);
    });

    it('returns native token when currencyId matches nativeCurrency', () => {
      const chainList = createChainList(makeDeployment());
      const token = chainList.getTokenByCurrencyId(1, 3);

      expect(token).toBeDefined();
      expect(token!.symbol).toBe('ETH');
      expect(token!.currencyId).toBe(3);
    });

    it('throws for unknown currencyId', () => {
      const chainList = createChainList(makeDeployment());

      expect(() => chainList.getTokenByCurrencyId(1, 999)).toThrow();
    });

    it('throws for unknown chainId', () => {
      const chainList = createChainList(makeDeployment());

      expect(() => chainList.getTokenByCurrencyId(999, 1)).toThrow();
    });
  });
});
