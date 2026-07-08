import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { decodeFunctionData, type Hex, type WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import ERC20ABI, { ERC20PermitABI } from '../../src/abi/erc20';
import { prepareSwapExecution } from '../../src/swap/prepare';
import { predictSafeAccountAddress } from '../../src/swap/safe/predict';
import { SwapMode, type ExecutionContext, type QuoteResponse, type SwapRoute } from '../../src/swap/types';
import { SwapCache } from '../../src/swap/wallet/cache';
import type { Aggregator } from '../../src/swap/aggregators/types';
import type { TokenInfo } from '../../src/domain';
import { makeChain, makeChainList } from '../helpers/chains';

vi.mock('../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn(),
}));

import { signPermitForAddressAndValue } from '../../src/services/allowance-utils';

const ARB_CHAIN = 42161;
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
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
  quote: {
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
  },
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
  sourceExecutionPaths: new Map([[ARB_CHAIN, 'ephemeral']]),
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

const makeCache = (token: TokenInfo = SUPPORTED_TOKEN) =>
  new SwapCache(
    makeSupportedChainList(token)
  );

describe('prepareSwapExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signPermitForAddressAndValue).mockResolvedValue(
      (`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex
    );
  });

  it('processes cache and returns parsed quote calls before execution', async () => {
    const route = makeRoute();
    const cache = makeCache();
    const publicClient = makePublicClient();

    const prepared = await prepareSwapExecution({
      chainList: makeSupportedChainList(),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(publicClient) },
      cache,
    });

    expect(publicClient.multicall).toHaveBeenCalled();
    expect(prepared.parsedQuotes).toHaveLength(2);
    expect(prepared.parsedQuotes[0]?.approval).not.toBeNull();
  });

  it('records source permit support without eagerly building the permit call', async () => {
    const route = makeRoute();

    const prepared = await prepareSwapExecution({
      chainList: makeSupportedChainList(),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(makePublicClient()) },
      cache: makeCache(),
    });

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
    expect((transferCall.args?.[1] as Hex).toLowerCase()).toBe(EPH.toLowerCase());
    expect(transferCall.args?.[2]).toBe(3000000000n);
  });

  it('builds a source EOA->Safe funding transfer targeting the predicted Safe on non-7702 source chains', async () => {
    // Parity with v1: the source-swap executor on a non-7702 chain is the Safe, so the EOA's input
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
    const expectedSafe = predictSafeAccountAddress(EPH).address;

    const prepared = await prepareSwapExecution({
      chainList: makeSupportedChainList(),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(makePublicClient()) },
      cache: makeCache(),
    });

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

    const prepared = await prepareSwapExecution({
      chainList,
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(makePublicClient()) },
      cache: makeCache(),
    });

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
      EPH,
      500000000n
    );
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

    const prepared = await prepareSwapExecution({
      chainList: makeSupportedChainList(),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(publicClient) },
      cache: makeCache(),
    });

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

    const prepared = await prepareSwapExecution({
      chainList: makeChainList(
        [makeChain(ARB_CHAIN, 'Arbitrum')],
        {
          contractAddress: '0x0000000000000000000000000000000000000001' as Hex,
          decimals: 6,
          logo: '',
          name: 'Unknown Token',
          symbol: 'UNK',
        }
      ),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: {
        get: vi.fn().mockReturnValue({
          multicall: vi.fn().mockResolvedValue([
            { status: 'failure' },
            { status: 'failure' },
            { status: 'failure' },
          ]),
          getCode: vi.fn().mockResolvedValue(undefined),
          readContract: vi.fn().mockResolvedValue(0n),
        }),
      },
      cache: makeCache({
        contractAddress: '0x0000000000000000000000000000000000000001' as Hex,
        decimals: 6,
        logo: '',
        name: 'Unknown Token',
        symbol: 'UNK',
      }),
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
    expect((approvalCall.args?.[0] as Hex).toLowerCase()).toBe(EPH.toLowerCase());
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

    const prepared = await prepareSwapExecution({
      chainList: makeChainList(
        [makeChain(ARB_CHAIN, 'Arbitrum')],
        {
          contractAddress: unsupportedToken,
          decimals: 6,
          logo: '',
          name: 'Unknown Token',
          symbol: 'UNK',
        }
      ),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(publicClient) },
      cache: makeCache({
        contractAddress: unsupportedToken,
        decimals: 6,
        logo: '',
        name: 'Unknown Token',
        symbol: 'UNK',
      }),
    });

    const sourceTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'source');

    expect(sourceTransfer?.authorization).toBeNull();
    expect(signPermitForAddressAndValue).not.toHaveBeenCalled();
  });

  it('converts bridge EOA balances from human Decimal to raw transfer amounts', async () => {
    const route = makeRoute();
    route.bridge = {
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

    const prepared = await prepareSwapExecution({
      chainList: makeSupportedChainList(),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(makePublicClient()) },
      cache: makeCache(),
    });

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'bridge');
    expect(bridgeTransfer).toBeDefined();
    expect(bridgeTransfer?.amount).toBe(5000000n);
  });

  it('targets the predicted Safe for the bridge funding transfer on non-7702 source chains', async () => {
    // Fast-path bridge (no source swap) on a non-7702 chain: the Safe deposit batch pulls the COT
    // from the Safe, so the EOA's COT must move EOA->Safe (Safe = permit spender + transferFrom
    // recipient). Targeting the ephemeral leaves the Safe empty and the deposit reverts (GS013).
    const route = makeRoute();
    route.source = { swaps: [], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: null, gasSwap: null },
    };
    route.bridge = {
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
      [{ ...makeChain(ARB_CHAIN, 'Arbitrum'), supports7702: false }],
      SUPPORTED_TOKEN
    );
    const expectedSafe = predictSafeAccountAddress(EPH).address;

    const prepared = await prepareSwapExecution({
      chainList,
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(makePublicClient()) },
      cache: makeCache(),
    });

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'bridge');
    expect(bridgeTransfer).toBeDefined();
    expect(bridgeTransfer!.targetAddress.toLowerCase()).toBe(expectedSafe.toLowerCase());
    const transferCall = decodeFunctionData({ abi: ERC20ABI, data: bridgeTransfer!.transferCall.data });
    expect(transferCall.functionName).toBe('transferFrom');
    expect((transferCall.args?.[1] as Hex).toLowerCase()).toBe(expectedSafe.toLowerCase());
  });

  it('does not build an eoa->ephemeral transfer for a native bridge asset (paid inline by the EOA)', async () => {
    // Phase 1b: native bridge sources are EOA-submitted payable deposits — there is no ERC-20
    // EOA->ephemeral funding transfer (and a transferFrom on a ZERO-address token is meaningless).
    const NATIVE = '0x0000000000000000000000000000000000000000' as Hex;
    const route = makeRoute();
    route.bridge = {
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

    const prepared = await prepareSwapExecution({
      chainList: makeSupportedChainList(),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(makePublicClient()) },
      cache: makeCache(),
    });

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'bridge');
    expect(bridgeTransfer).toBeUndefined();
  });

  it('skips bridge eoa->ephemeral authorization when cached allowance already covers the amount', async () => {
    const route = makeRoute();
    route.sourceExecutionPaths = new Map([[ARB_CHAIN, 'ephemeral']]);
    // Isolate the bridge: no source swap (this test asserts only on the bridge transfer).
    route.source = { ...route.source, swaps: [] };
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: null, gasSwap: null },
    };
    route.bridge = {
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
      multicall: vi.fn().mockResolvedValue([{ result: 5000000n }, { result: 5000000n }]),
      getCode: vi.fn().mockResolvedValue(undefined),
      readContract: vi.fn().mockResolvedValue(0n),
    };

    const prepared = await prepareSwapExecution({
      chainList: makeSupportedChainList(),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(publicClient) },
      cache: makeCache(),
    });

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find((entry) => entry.reason === 'bridge');

    expect(bridgeTransfer?.authorization).toBeNull();
    expect(signPermitForAddressAndValue).not.toHaveBeenCalled();
  });

  it('chooses approve over permit for a bridge COT transfer when the funding EOA is delegated', async () => {
    const route = makeRoute();
    route.sourceExecutionPaths = new Map([[ARB_CHAIN, 'ephemeral']]);
    // Isolate the bridge: no source swap, so the only setCode query is the funding EOA's.
    route.source = { ...route.source, swaps: [] };
    route.destination = {
      ...route.destination,
      eoaToEphemeral: null,
      swap: { tokenSwap: null, gasSwap: null },
    };
    route.bridge = {
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

    // Allowance below the amount (would normally trigger a permit), and the funding EOA carries
    // an EIP-7702 delegation designator, so permit must be swapped for a paid approve.
    const publicClient = {
      multicall: vi.fn().mockResolvedValue([{ result: 0n, status: 'success' }]),
      getCode: vi.fn().mockResolvedValue(`0xef0100${'ab'.repeat(20)}`),
      readContract: vi.fn().mockResolvedValue(0n),
    };

    const prepared = await prepareSwapExecution({
      chainList: makeSupportedChainList(),
      route,
      source: route.source,
      destination: route.destination,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralWallet: { address: EPH } as PrivateKeyAccount,
      publicClientList: { get: vi.fn().mockReturnValue(publicClient) },
      cache: makeCache(),
    });

    const bridgeTransfer = prepared.eoaToEphemeralTransfers.find(
      (entry) => entry.reason === 'bridge'
    );

    expect(publicClient.getCode).toHaveBeenCalledWith({ address: EOA });
    expect(bridgeTransfer?.authorization?.kind).toBe('approve');
    expect(signPermitForAddressAndValue).not.toHaveBeenCalled();
  });
});
