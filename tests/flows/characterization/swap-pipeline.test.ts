import { CurrencyID, Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { type Hex, toHex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_CHAINS, SWAP_STEPS, type SwapData, SwapMode } from '../../../src/commons';
import { ZERO_ADDRESS } from '../../../src/core/constants';
import { equalFold } from '../../../src/core/utils';
import { convertTo32Bytes } from '../../../src/swap/utils';

const determineSwapRouteMock = vi.hoisted(() => vi.fn());
const pipelineEvents = vi.hoisted((): string[] => []);

vi.mock('../../../src/swap/route', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/swap/route')>('../../../src/swap/route');
  return {
    ...actual,
    determineSwapRoute: determineSwapRouteMock,
  };
});

vi.mock('../../../src/swap/ob', () => ({
  SourceSwapsHandler: class {
    private readonly route;

    process = vi.fn(async (metadata) => {
      pipelineEvents.push('source.process');
      metadata.src.push({
        chid: convertTo32Bytes(SUPPORTED_CHAINS.ARBITRUM),
        swaps: [],
        tx_hash: convertTo32Bytes(
          '0x1111111111111111111111111111111111111111111111111111111111111111'
        ),
        univ: Universe.ETHEREUM,
      });
      return [
        {
          amount: new Decimal(1),
          chainID: SUPPORTED_CHAINS.ARBITRUM,
          tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Hex,
        },
      ];
    });

    getCaliburSourceChains = vi.fn(() =>
      this.route.source.swaps
        .map((swap) => swap.chainID)
        .filter((chainID, index, self) => self.indexOf(chainID) === index)
        .filter((chainID) => this.route.source.executions[chainID]?.mode === 'calibur_account')
    );

    constructor(route) {
      this.route = route;
      pipelineEvents.push('source.construct');
    }
  },
  BridgeHandler: class {
    private readonly options;

    constructor(_bridge, options) {
      this.options = options;
      pipelineEvents.push('bridge.construct');
    }

    getPotentialCaliburDepositChains = vi.fn(() => []);

    process = vi.fn(async (metadata, assets) => {
      pipelineEvents.push(`bridge.process:${assets.length}`);
      await this.options.wallet.cosmos.signAndBroadcast(
        this.options.address.cosmos,
        [{ typeUrl: '/avail.nexus.v1.MsgCreateRequestForFunds', value: {} }],
        'auto'
      );
      metadata.rff_id = 42n;
    });
  },
  DestinationSwapHandler: class {
    createPermit = vi.fn(async () => {
      pipelineEvents.push('destination.createPermit');
    });

    process = vi.fn(async () => {
      pipelineEvents.push('destination.process');
    });

    constructor() {
      pipelineEvents.push('destination.construct');
    }
  },
}));

import { swap } from '../../../src/flows/swap';

describe('swap pipeline characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineEvents.length = 0;
  });

  it('publishes the bridge intent through cosmos signing during the current v1 swap flow', async () => {
    const route = makeCurrentRoute();
    determineSwapRouteMock.mockResolvedValue(route);

    const signAndBroadcast = vi.fn().mockResolvedValue({
      code: 0,
      transactionHash: 'COSMOS_TX',
    });
    const vscCreateRFF = vi.fn();
    const onEvent = vi.fn();
    const onSwapIntent = vi.fn(({ allow }) => allow());

    const result = await swap(makeSwapInput(), {
      address: {
        cosmos: 'avail1current',
        eoa: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ephemeral: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      chainList: makeChainList(),
      cosmosQueryClient: {} as never,
      intentExplorerUrl: 'https://intent.example',
      onEvent,
      onSwapIntent,
      vscClient: { vscCreateRFF } as never,
      wallet: {
        cosmos: { signAndBroadcast } as never,
        eoa: {} as never,
        ephemeral: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } as never,
      },
    });

    expect(onSwapIntent).toHaveBeenCalledTimes(1);
    expect(pipelineEvents).toEqual([
      'source.construct',
      'bridge.construct',
      'destination.construct',
      'destination.createPermit',
      'source.process',
      'bridge.process:1',
      'destination.process',
    ]);
    expect(signAndBroadcast).toHaveBeenCalledTimes(1);
    expect(signAndBroadcast.mock.calls[0][1][0].typeUrl).toBe(
      '/avail.nexus.v1.MsgCreateRequestForFunds'
    );
    expect(vscCreateRFF).not.toHaveBeenCalled();
    expect(result.explorerURL).toBe('https://intent.example/intent/42');
    expect(result.swapRoute).toBe(route);
    expect(onEvent).toHaveBeenCalledWith({
      name: 'SWAP_STEP_COMPLETE',
      args: SWAP_STEPS.SWAP_START,
    });
  });

  it('ensures Calibur source accounts before source swaps start', async () => {
    const route = makeCurrentRoute();
    route.source.swaps = [{ chainID: SUPPORTED_CHAINS.HYPEREVM } as never];
    route.source.executions = {
      [SUPPORTED_CHAINS.HYPEREVM]: {
        address: '0x3333333333333333333333333333333333333333' as Hex,
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Hex,
        mode: 'calibur_account',
      },
    };
    determineSwapRouteMock.mockResolvedValue(route);

    const vscEnsureCaliburAccount = vi.fn(async ({ chainId }) => {
      pipelineEvents.push(`ensure:${chainId}`);
      return {};
    });
    const onSwapIntent = vi.fn(({ allow }) => allow());

    await swap(makeSwapInput(), {
      address: {
        cosmos: 'avail1current',
        eoa: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ephemeral: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      chainList: makeChainList(),
      cosmosQueryClient: {} as never,
      intentExplorerUrl: 'https://intent.example',
      onSwapIntent,
      vscClient: { vscEnsureCaliburAccount } as never,
      wallet: {
        cosmos: { signAndBroadcast: vi.fn().mockResolvedValue({ code: 0 }) } as never,
        eoa: {} as never,
        ephemeral: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } as never,
      },
    });

    expect(pipelineEvents.indexOf(`ensure:${SUPPORTED_CHAINS.HYPEREVM}`)).toBeLessThan(
      pipelineEvents.indexOf('source.process')
    );
    expect(vscEnsureCaliburAccount).toHaveBeenCalledWith({
      chainId: SUPPORTED_CHAINS.HYPEREVM,
      entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      keys: [
        {
          keyType: 2,
          publicKey: convertTo32Bytes('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
          settings: convertTo32Bytes(1n << 200n),
        },
        {
          keyType: 2,
          publicKey: convertTo32Bytes('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
          settings: convertTo32Bytes(1n << 200n),
        },
      ],
      owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });
});

const makeSwapInput = (): SwapData => ({
  mode: SwapMode.EXACT_IN,
  data: {
    from: [
      {
        amount: 1_000_000n,
        chainId: SUPPORTED_CHAINS.ARBITRUM,
        tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      },
    ],
    toChainId: SUPPORTED_CHAINS.BASE,
    toTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
});

const makeCurrentRoute = () => ({
  type: 'EXACT_IN' as const,
  source: {
    creationTime: 1,
    executions: {
      [SUPPORTED_CHAINS.ARBITRUM]: {
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
        entryPoint: null,
        mode: '7702' as const,
      },
    },
    swaps: [],
  },
  bridge: {
    amount: new Decimal(1),
    assets: [],
    chainID: SUPPORTED_CHAINS.BASE,
    decimals: 6,
    estimatedFees: {
      caGas: '0',
      gasSupplied: '0',
      protocol: '0',
      solver: '0',
    },
    recipientAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
    tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Hex,
  },
  destination: {
    chainId: SUPPORTED_CHAINS.BASE,
    eoaToDestinationAccount: null,
    execution: {
      address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
      entryPoint: null,
      mode: '7702' as const,
    },
    getDstSwap: vi.fn(async () => null),
    inputAmount: { max: new Decimal(1), min: new Decimal(1) },
    swap: {
      creationTime: 1,
      gasSwap: null,
      tokenSwap: null,
    },
  },
  buffer: { amount: '0' },
  dstTokenInfo: {
    contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Hex,
    decimals: 6,
    name: 'USD Coin',
    symbol: 'USDC',
  },
  extras: {
    aggregators: [],
    assetsUsed: [
      {
        amount: '1',
        chainID: SUPPORTED_CHAINS.ARBITRUM,
        contractAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Hex,
        decimals: 6,
        symbol: 'USDC',
      },
    ],
    balances: [
      {
        amount: '1',
        chainID: SUPPORTED_CHAINS.ARBITRUM,
        decimals: 6,
        logo: '',
        symbol: 'USDC',
        tokenAddress: toHex(convertTo32Bytes('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')),
        universe: Universe.ETHEREUM,
        value: 1,
      },
    ],
    oraclePrices: {},
  },
});

const makeChainList = () => ({
  getChainByID: vi.fn((id: number) => {
    if (
      id !== SUPPORTED_CHAINS.BASE &&
      id !== SUPPORTED_CHAINS.ARBITRUM &&
      id !== SUPPORTED_CHAINS.HYPEREVM
    )
      return undefined;
    return {
      blockExplorers: { default: { name: 'Explorer', url: `https://explorer.example/${id}` } },
      custom: { icon: '', knownTokens: [] },
      id,
      name:
        id === SUPPORTED_CHAINS.BASE
          ? 'Base'
          : id === SUPPORTED_CHAINS.HYPEREVM
            ? 'HyperEVM'
            : 'Arbitrum',
      ankrName: 'mock',
      nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
      pectraUpgradeSupport: id !== SUPPORTED_CHAINS.HYPEREVM,
      rpcUrls: { default: { http: [], webSocket: [] } },
      swapSupported: true,
      universe: Universe.ETHEREUM,
    };
  }),
  getVaultContractAddress: vi.fn(() => '0xcccccccccccccccccccccccccccccccccccccccc' as Hex),
  getTokenByAddress: vi.fn((_chainId: number, token: Hex) => ({
    contractAddress: token,
    decimals: equalFold(token, ZERO_ADDRESS) ? 18 : 6,
    name: equalFold(token, ZERO_ADDRESS) ? 'Ether' : 'USD Coin',
    symbol: equalFold(token, ZERO_ADDRESS) ? 'ETH' : CurrencyID[CurrencyID.USDC],
  })),
});
