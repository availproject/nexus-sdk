import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { decodeFunctionData, type Hex, type PublicClient, type WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import ERC20ABI, { ERC20PermitABI } from '../../src/abi/erc20';
import { prepareSwapExecution, startSwapCacheWarmup } from '../../src/swap/prepare';
import { predictSafeAccountAddressV2 } from '../../src/swap/safe/predict';
import type { EnsureSafeAccountV2Response } from '../../src/swap/safe/types';
import { CurrencyID } from '../../src/swap/cot';
import { SwapMode, type ExecutionContext, type QuoteResponse, type SwapRoute } from '../../src/swap/types';
import { SwapCache } from '../../src/swap/wallet/cache';
import type { Aggregator } from '../../src/swap/aggregators/types';
import type { TokenInfo } from '../../src/domain';
import { makeChain, makeChainList } from '../helpers/chains';
import { makeTimingHooks } from '../helpers/timing';
import { quoteFixture } from '../helpers/quote';

vi.mock('../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn(),
}));

import { signPermitForAddressAndValue } from '../../src/services/allowance-utils';

const ARB_CHAIN = 42161;
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const DAI_ARB = '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
const SAFE_ACCOUNT = predictSafeAccountAddressV2(EOA, EPH);
const SAFE = SAFE_ACCOUNT.address;
const APPROVAL = '0x1111111111111111111111111111111111111111' as Hex;
const SUPPORTED_TOKEN: TokenInfo = {
  contractAddress: USDC_ARB,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
  permitVariant: 1,
  permitVersion: 2,
};

const makeQuoteResponse = (): QuoteResponse => ({
  chainID: ARB_CHAIN,
  quote: quoteFixture({
    input: {
      contractAddress: USDC_ARB,
      amount: '3000',
      amountRaw: 3000000000n,
      decimals: 6,
      value: 3000,
      symbol: 'USDC',
    },
    output: {
      contractAddress: WETH,
      amount: '1.0',
      amountRaw: 1000000000000000000n,
      decimals: 18,
      value: 3000,
      symbol: 'WETH',
    },
    txData: {
      approvalAddress: APPROVAL,
      tx: {
        to: '0x2222222222222222222222222222222222222222' as Hex,
        data: '0xabcdef' as Hex,
        value: '0x0' as Hex,
      },
    },
  }),
  holding: {
    chainID: ARB_CHAIN,
    tokenAddress: USDC_ARB,
    amountRaw: 3000000000n,
    decimals: 6,
    symbol: 'USDC',
  },
  aggregator: {} as Aggregator,
});

const makeRoute = (): SwapRoute => ({
  type: SwapMode.EXACT_OUT,
  settlementCurrencyId: CurrencyID.USDC,
  sameTokenBridge: false,
  source: { swaps: [makeQuoteResponse()], creationTime: Date.now(), srcBuffer: new Decimal(0) },
  bridge: null,
  destination: {
    chainId: ARB_CHAIN,
    eoaToEphemeral: { amount: 500000000n, contractAddress: USDC_ARB },
    inputAmount: { min: new Decimal('3000'), max: new Decimal('3150') },
    swap: { tokenSwap: makeQuoteResponse(), gasSwap: null },
    getDstSwap: vi.fn().mockResolvedValue(null),
  },
  buffer: { amount: '0' },
  dstTokenInfo: {
    contractAddress: WETH,
    decimals: 18,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    logo: '',
  } as TokenInfo,
  extras: { aggregators: [], oraclePrices: [], balances: [], assetsUsed: [] },
  sourceExecutionPaths: new Map([[ARB_CHAIN, 'safe']]),
});

const makePublicClient = () =>
  ({
    multicall: vi.fn().mockResolvedValue([
      { status: 'success', result: undefined },
      { status: 'failure', error: new Error('dai permit missing') },
      { status: 'success', result: '2' },
      { status: 'failure', error: new Error('unused') },
      { status: 'failure', error: new Error('unused') },
    ]),
    getCode: vi.fn().mockResolvedValue(undefined),
    readContract: vi.fn().mockResolvedValue(0n),
  }) as unknown as ExecutionContext['publicClientList']['get'] extends (...args: any[]) => infer T ? T : never;

const makeSupportedChainList = (token: TokenInfo = SUPPORTED_TOKEN) =>
  makeChainList(
    [makeChain(ARB_CHAIN, 'Arbitrum')],
    token
  );

const resolvedDeployment = (): Promise<EnsureSafeAccountV2Response> =>
  Promise.resolve({
    chainId: ARB_CHAIN,
    eoaAddress: EOA,
    ephemeralAddress: EPH,
    address: SAFE,
    factoryAddress: SAFE_ACCOUNT.factoryAddress,
    exists: true,
  });

const prepareRoute = (
  route: SwapRoute,
  options: {
    chainList?: ReturnType<typeof makeSupportedChainList>;
    publicClient?: Pick<PublicClient, 'getCode' | 'multicall' | 'readContract'>;
    safeDeploymentPromises?: ReadonlyMap<number, Promise<EnsureSafeAccountV2Response>>;
    timing?: ReturnType<typeof makeTimingHooks>;
  } = {}
) => {
  const chainList = options.chainList ?? makeSupportedChainList();
  const publicClientList = {
    get: vi.fn().mockReturnValue(options.publicClient ?? makePublicClient()),
  } as ExecutionContext['publicClientList'];
  const cacheWarmup = startSwapCacheWarmup({
    chainList,
    route,
    source: route.source,
    destination: route.destination,
    eoaAddress: EOA,
    ephemeralWallet: { address: EPH } as PrivateKeyAccount,
    publicClientList,
    safeAccount: SAFE_ACCOUNT,
    timing: options.timing,
  });

  return prepareSwapExecution({
    chainList,
    route,
    source: route.source,
    destination: route.destination,
    eoaAddress: EOA,
    eoaWallet: {} as WalletClient,
    ephemeralWallet: { address: EPH } as PrivateKeyAccount,
    publicClientList,
    cacheWarmup,
    safeDeploymentPromises:
      options.safeDeploymentPromises ?? new Map([[ARB_CHAIN, resolvedDeployment()]]),
    timing: options.timing,
  });
};

describe('prepareSwapExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signPermitForAddressAndValue).mockResolvedValue(
      (`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex
    );
  });

  it('processes cache and returns parsed quote calls before execution', async () => {
    const route = makeRoute();
    const publicClient = makePublicClient();
    const timing = makeTimingHooks();

    const prepared = await prepareRoute(route, { publicClient, timing });

    expect(publicClient.multicall).toHaveBeenCalled();
    expect(prepared.parsedQuotes).toHaveLength(2);
    expect(prepared.parsedQuotes[0]?.approval).not.toBeNull();
    expect(timing.startSpan.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'flow.swap.prepare.cache_start',
        'flow.swap.prepare.cache_wait',
        'flow.swap.prepare.parse_quotes',
        'flow.swap.prepare.build_transfers',
      ])
    );
  });

  it('records source permit support without eagerly building the permit call', async () => {
    const route = makeRoute();

    const prepared = await prepareRoute(route);

    const sourceTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'source');
    expect(sourceTransfer).toBeDefined();
    expect(sourceTransfer?.authorization?.kind).toBe('permit');
    if (!sourceTransfer || sourceTransfer.authorization === null) {
      throw new Error('Expected source authorization to exist');
    }
    expect(sourceTransfer.authorization.call).toBeNull();
    expect(sourceTransfer.authorization.permit!.signature).toBeNull();

    const transferCall = decodeFunctionData({
      abi: ERC20ABI,
      data: sourceTransfer.transferCall.data,
    });
    expect(transferCall.functionName).toBe('transferFrom');
    expect((transferCall.args?.[0] as Hex).toLowerCase()).toBe(EOA.toLowerCase());
    expect((transferCall.args?.[1] as Hex).toLowerCase()).toBe(SAFE.toLowerCase());
    expect(transferCall.args?.[2]).toBe(3000000000n);
  });

  it('leaves direct-destination funding to the executor and warms every persisted holding', async () => {
    const route = makeRoute();
    route.directDestination = true;
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: null, gasSwap: null },
    };
    route.extras.directDestination = {
      dstHoldings: [
        { ...route.source.swaps[0].holding, value: 3000 },
        {
          chainID: ARB_CHAIN,
          tokenAddress: DAI_ARB,
          amountRaw: 100000000000000000000n,
          decimals: 18,
          symbol: 'DAI',
          value: 100,
        },
      ],
      toAmountRaw: 1000000000000000000n,
      toNativeAmountRaw: 0n,
    };
    const addPermitQuery = vi.spyOn(SwapCache.prototype, 'addPermitQuery');
    const addAllowanceQuery = vi.spyOn(SwapCache.prototype, 'addAllowanceQuery');

    const prepared = await prepareRoute(route);

    expect(prepared.parsedQuotes).toHaveLength(1);
    expect(prepared.eoaToEphemeralTransfers).toEqual([]);
    expect(addPermitQuery).toHaveBeenCalledWith(USDC_ARB, ARB_CHAIN);
    expect(addPermitQuery).toHaveBeenCalledWith(DAI_ARB, ARB_CHAIN);
    expect(addAllowanceQuery).toHaveBeenCalledWith(DAI_ARB, EOA, SAFE, ARB_CHAIN);
  });

  it('does not prepare Safe custody for a direct bridge', async () => {
    const route = makeRoute();
    route.source = { swaps: [], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    route.sourceExecutionPaths = new Map([[ARB_CHAIN, 'safe']]);
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: null, gasSwap: null },
    };
    route.bridge = {
      provider: 'nexus',
      amount: new Decimal('3'),
      amounts: {
        tokenAmount: new Decimal('3'),
        gasInCot: new Decimal(0),
        totalAmount: new Decimal('3'),
      },
      assets: [
        {
          chainID: ARB_CHAIN,
          contractAddress: USDC_ARB,
          decimals: 6,
          eoaBalance: new Decimal('3'),
          ephemeralBalance: new Decimal(0),
        },
      ],
      chainID: ARB_CHAIN + 1,
      decimals: 6,
      tokenAddress: USDC_ARB,
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    };
    const addSafeAccountQuery = vi.spyOn(SwapCache.prototype, 'addSafeAccountQuery');
    const addAllowanceQuery = vi.spyOn(SwapCache.prototype, 'addAllowanceQuery');

    const prepared = await prepareRoute(route, { safeDeploymentPromises: new Map() });

    expect(prepared.eoaToEphemeralTransfers).toEqual([]);
    expect(addSafeAccountQuery).not.toHaveBeenCalled();
    expect(addAllowanceQuery).not.toHaveBeenCalled();
  });

  it('builds a source EOA->Safe funding transfer targeting the predicted Safe on Safe V2 source chains', async () => {
    // Parity with v1: the source-swap executor on a Safe V2 chain is the Safe, so the EOA's input
    // ERC20 must be moved EOA -> Safe (and the Safe is the approve/permit spender) before the
    // aggregator swap runs as the Safe. Without it the Safe holds zero of the token and the swap
    // reverts on-chain (GS013).
    const route = makeRoute();
    route.sourceExecutionPaths = new Map([[ARB_CHAIN, 'safe']]);
    // Isolate the source leg.
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: null, gasSwap: null },
    };
    const expectedSafe = predictSafeAccountAddressV2(EOA, EPH).address;

    const prepared = await prepareRoute(route);

    const sourceTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'source');
    expect(sourceTransfer).toBeDefined();
    expect(sourceTransfer!.targetAddress.toLowerCase()).toBe(expectedSafe.toLowerCase());

    const transferCall = decodeFunctionData({
      abi: ERC20ABI,
      data: sourceTransfer!.transferCall.data,
    });
    expect(transferCall.functionName).toBe('transferFrom');
    expect((transferCall.args?.[0] as Hex).toLowerCase()).toBe(EOA.toLowerCase());
    expect((transferCall.args?.[1] as Hex).toLowerCase()).toBe(expectedSafe.toLowerCase());
    expect(transferCall.args?.[2]).toBe(3000000000n);
  });

  it('builds deterministic destination eoaToEphemeral transfer preparation and eagerly signs its permit', async () => {
    const route = makeRoute();
    const chainList = makeSupportedChainList();

    const prepared = await prepareRoute(route, { chainList });

    const destinationTransfer = prepared.eoaToEphemeralTransfers.find(
      (entry) => entry.reason === 'destination'
    );
    expect(destinationTransfer).toBeDefined();
    expect(destinationTransfer?.amount).toBe(500000000n);
    expect(destinationTransfer?.tokenAddress).toBe(USDC_ARB);
    expect(destinationTransfer?.authorization?.kind).toBe('permit');
    if (!destinationTransfer || destinationTransfer.authorization?.kind !== 'permit') {
      throw new Error('Expected destination permit authorization to exist');
    }

    const permitCall = decodeFunctionData({
      abi: ERC20PermitABI,
      data: destinationTransfer.authorization.call!.data,
    });
    expect(permitCall.functionName).toBe('permit');
    expect(destinationTransfer.authorization.permit.signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(signPermitForAddressAndValue).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAddress: USDC_ARB }),
      chainList.getChainByID(ARB_CHAIN),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ address: EOA }),
      predictSafeAccountAddressV2(EOA, EPH).address,
      500000000n,
      expect.anything()
    );
  });

  it('waits for the destination Safe deployment before eagerly signing its permit', async () => {
    const route = makeRoute();
    let resolveDeployment!: () => void;
    const deployment = new Promise<EnsureSafeAccountV2Response>((resolve) => {
      resolveDeployment = () =>
        resolve({
          chainId: ARB_CHAIN,
          eoaAddress: EOA,
          ephemeralAddress: EPH,
          address: predictSafeAccountAddressV2(EOA, EPH).address,
          factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
          exists: true,
        });
    });

    const preparation = prepareRoute(route, {
      safeDeploymentPromises: new Map([[ARB_CHAIN, deployment]]),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signPermitForAddressAndValue).not.toHaveBeenCalled();
    resolveDeployment();
    await preparation;

    expect(signPermitForAddressAndValue).toHaveBeenCalledTimes(1);
  });

  it('skips source and destination eoa->ephemeral authorization when cached allowance already covers the amount', async () => {
    const route = makeRoute();
    const sufficientAllowance = 3000000000n;
    const publicClient = {
      multicall: vi.fn().mockResolvedValue([
        { result: 0n },
        { result: 0n },
        { result: sufficientAllowance },
        { result: sufficientAllowance },
        { result: 0n },
      ]),
      getCode: vi.fn().mockResolvedValue(undefined),
      readContract: vi.fn(),
    };

    const prepared = await prepareRoute(route, { publicClient });

    const sourceTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'source');
    const destinationTransfer = prepared.eoaToEphemeralTransfers.find(
      (entry) => entry.reason === 'destination'
    );

    expect(sourceTransfer?.authorization).toBeNull();
    expect(destinationTransfer?.authorization).toBeNull();
    expect(signPermitForAddressAndValue).not.toHaveBeenCalled();
  });

  it('falls back to an EOA approval call when permit support is unavailable', async () => {
    const route = makeRoute();
    route.source.swaps[0] = {
      ...route.source.swaps[0],
      quote: {
        ...route.source.swaps[0].quote,
        input: {
          ...route.source.swaps[0].quote.input,
          contractAddress: '0x0000000000000000000000000000000000000001' as Hex,
        },
      },
      holding: {
        ...route.source.swaps[0].holding,
        tokenAddress: '0x0000000000000000000000000000000000000001' as Hex,
      },
    };

    const chainList = makeChainList(
      [makeChain(ARB_CHAIN, 'Arbitrum')],
      {
        contractAddress: '0x0000000000000000000000000000000000000001' as Hex,
        decimals: 6,
        logo: '',
        name: 'Unknown Token',
        symbol: 'UNK',
      }
    );
    const publicClient = {
      multicall: vi.fn().mockResolvedValue([
        { status: 'failure' },
        { status: 'failure' },
        { status: 'failure' },
      ]),
      getCode: vi.fn().mockResolvedValue(undefined),
      readContract: vi.fn().mockResolvedValue(0n),
    };

    const prepared = await prepareRoute(route, {
      chainList,
      publicClient,
    });

    const sourceTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'source');
    expect(sourceTransfer?.authorization?.kind).toBe('approve');
    if (!sourceTransfer || sourceTransfer.authorization === null) {
      throw new Error('Expected source authorization to exist');
    }

    const approvalCall = decodeFunctionData({
      abi: ERC20ABI,
      data: sourceTransfer.authorization.call!.data,
    });
    expect(approvalCall.functionName).toBe('approve');
    expect((approvalCall.args?.[0] as Hex).toLowerCase()).toBe(SAFE.toLowerCase());
    expect(approvalCall.args?.[1]).toBe(3000000000n);
  });

  it('skips unsupported-permit eoa->ephemeral approval when cached allowance already covers the amount', async () => {
    const unsupportedToken = '0x0000000000000000000000000000000000000001' as Hex;
    const route = makeRoute();
    route.source.swaps[0] = {
      ...route.source.swaps[0],
      quote: {
        ...route.source.swaps[0].quote,
        input: {
          ...route.source.swaps[0].quote.input,
          contractAddress: unsupportedToken,
        },
      },
      holding: {
        ...route.source.swaps[0].holding,
        tokenAddress: unsupportedToken,
      },
    };
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: null, gasSwap: null },
    };

    const publicClient = {
      multicall: vi
        .fn()
        .mockResolvedValueOnce([{ result: 0n }, { result: 3000000000n }])
        .mockResolvedValueOnce([
          { status: 'failure' },
          { status: 'failure' },
          { status: 'failure' },
        ]),
      getCode: vi.fn().mockResolvedValue(undefined),
      readContract: vi.fn().mockResolvedValue(0n),
    };

    const chainList = makeChainList(
      [makeChain(ARB_CHAIN, 'Arbitrum')],
      {
        contractAddress: unsupportedToken,
        decimals: 6,
        logo: '',
        name: 'Unknown Token',
        symbol: 'UNK',
      }
    );

    const prepared = await prepareRoute(route, {
      chainList,
      publicClient,
    });

    const sourceTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'source');

    expect(sourceTransfer?.authorization).toBeNull();
    expect(signPermitForAddressAndValue).not.toHaveBeenCalled();
  });

  it('converts bridge EOA balances from human Decimal to raw transfer amounts', async () => {
    const route = makeRoute();
    route.bridge = {
      provider: 'nexus',
      amount: new Decimal('5'),
      amounts: {
        tokenAmount: new Decimal('5'),
        gasInCot: new Decimal(0),
        totalAmount: new Decimal('5'),
      },
      assets: [
        {
          chainID: ARB_CHAIN,
          contractAddress: USDC_ARB,
          decimals: 6,
          eoaBalance: new Decimal('5'),
          ephemeralBalance: new Decimal(0),
        },
      ],
      chainID: ARB_CHAIN,
      decimals: 6,
      tokenAddress: USDC_ARB,
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    };

    const prepared = await prepareRoute(route);

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'bridge');
    expect(bridgeTransfer).toBeDefined();
    expect(bridgeTransfer?.amount).toBe(5000000n);
  });

  it('keeps no-source-swap bridge custody in the EOA before a destination swap', async () => {
    const route = makeRoute();
    route.source = { swaps: [], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: makeQuoteResponse(), gasSwap: null },
    };
    route.bridge = {
      provider: 'nexus',
      amount: new Decimal('5'),
      amounts: {
        tokenAmount: new Decimal('5'),
        gasInCot: new Decimal(0),
        totalAmount: new Decimal('5'),
      },
      assets: [
        {
          chainID: ARB_CHAIN,
          contractAddress: USDC_ARB,
          decimals: 6,
          eoaBalance: new Decimal('5'),
          ephemeralBalance: new Decimal(0),
        },
      ],
      chainID: ARB_CHAIN,
      decimals: 6,
      tokenAddress: USDC_ARB,
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    };
    const chainList = makeChainList(
      [{ ...makeChain(ARB_CHAIN, 'Arbitrum'), swapSupported: true }],
      SUPPORTED_TOKEN
    );
    const prepared = await prepareRoute(route, { chainList });

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'bridge');
    expect(bridgeTransfer).toBeUndefined();
  });

  it('does not build an eoa->ephemeral transfer for a native bridge asset (paid inline by the EOA)', async () => {
    // Phase 1b: native bridge sources are EOA-submitted payable deposits — there is no ERC-20
    // EOA->ephemeral funding transfer (and a transferFrom on a ZERO-address token is meaningless).
    const NATIVE = '0x0000000000000000000000000000000000000000' as Hex;
    const route = makeRoute();
    route.bridge = {
      provider: 'nexus',
      amount: new Decimal('1'),
      amounts: {
        tokenAmount: new Decimal('1'),
        gasInCot: new Decimal(0),
        totalAmount: new Decimal('1'),
      },
      assets: [
        {
          chainID: ARB_CHAIN,
          contractAddress: NATIVE,
          decimals: 18,
          eoaBalance: new Decimal('1'),
          ephemeralBalance: new Decimal(0),
        },
      ],
      chainID: ARB_CHAIN,
      decimals: 18,
      tokenAddress: NATIVE,
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    };

    const prepared = await prepareRoute(route);

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'bridge');
    expect(bridgeTransfer).toBeUndefined();
  });

  it('skips bridge eoa->ephemeral authorization when cached allowance already covers the amount', async () => {
    const route = makeRoute();
    route.sourceExecutionPaths = new Map([[ARB_CHAIN, 'safe']]);
    // Keep a source swap so this remains the composed Safe-funded bridge path.
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: makeQuoteResponse(), gasSwap: null },
    };
    route.bridge = {
      provider: 'nexus',
      amount: new Decimal('5'),
      amounts: {
        tokenAmount: new Decimal('5'),
        gasInCot: new Decimal(0),
        totalAmount: new Decimal('5'),
      },
      assets: [
        {
          chainID: ARB_CHAIN,
          contractAddress: USDC_ARB,
          decimals: 6,
          eoaBalance: new Decimal('5'),
          ephemeralBalance: new Decimal(0),
        },
      ],
      chainID: ARB_CHAIN,
      decimals: 6,
      tokenAddress: USDC_ARB,
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    };

    const publicClient = {
      multicall: vi.fn().mockImplementation(async ({ contracts }: { contracts: unknown[] }) =>
        contracts.map(() => ({ result: 5000000n, status: 'success' }))
      ),
      getCode: vi.fn().mockResolvedValue(undefined),
      readContract: vi.fn().mockResolvedValue(0n),
    };

    const prepared = await prepareRoute(route, {
      publicClient,
    });

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'bridge');

    expect(bridgeTransfer?.authorization).toBeNull();
    expect(signPermitForAddressAndValue).not.toHaveBeenCalled();
  });

  it('ignores legacy delegation metadata and keeps Safe funding on the permit path', async () => {
    const route = makeRoute();
    route.sourceExecutionPaths = new Map([[ARB_CHAIN, 'safe']]);
    // Keep a source swap so this remains the composed Safe-funded bridge path.
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: makeQuoteResponse(), gasSwap: null },
    };
    route.bridge = {
      provider: 'nexus',
      amount: new Decimal('5'),
      amounts: {
        tokenAmount: new Decimal('5'),
        gasInCot: new Decimal(0),
        totalAmount: new Decimal('5'),
      },
      assets: [
        {
          chainID: ARB_CHAIN,
          contractAddress: USDC_ARB,
          decimals: 6,
          eoaBalance: new Decimal('5'),
          ephemeralBalance: new Decimal(0),
        },
      ],
      chainID: ARB_CHAIN,
      decimals: 6,
      tokenAddress: USDC_ARB,
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    };

    // Legacy delegation bytecode is not consulted by the Safe V2-only execution path.
    const publicClient = {
      multicall: vi.fn().mockResolvedValue([{ result: 0n, status: 'success' }]),
      getCode: vi.fn().mockImplementation(({ address }: { address: Hex }) =>
        address.toLowerCase() === EPH.toLowerCase()
          ? Promise.resolve(`0xef0100${'ab'.repeat(20)}`)
          : Promise.resolve(undefined)
      ),
      readContract: vi.fn().mockResolvedValue(0n),
    };

    const prepared = await prepareRoute(route, {
      publicClient,
    });

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find(
      (entry) => entry.reason === 'bridge'
    );

    expect(publicClient.getCode).toHaveBeenCalledWith({ address: SAFE });
    expect(bridgeTransfer?.authorization?.kind).toBe('permit');
    expect(signPermitForAddressAndValue).not.toHaveBeenCalled();
  });
});
