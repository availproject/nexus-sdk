import { CurrencyID, Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import Long from 'long';
import { type Hex, toHex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_CHAINS, type SwapData, SwapMode } from '../../../src/commons';
import { ZERO_ADDRESS } from '../../../src/core/constants';
import { equalFold } from '../../../src/core/utils';
import { swap } from '../../../src/flows/swap';
import { EADDRESS } from '../../../src/swap/constants';
import { SAFE_SALT_NONCE } from '../../../src/swap/safe.constants';
import { predictSafeAccountAddress } from '../../../src/swap/safetx';
import { convertTo32Bytes } from '../../../src/swap/utils';

const determineSwapRouteMock = vi.hoisted(() => vi.fn());
const createPermitAndTransferFromTxMock = vi.hoisted(() => vi.fn());
const createPermitOnlyApprovalTxMock = vi.hoisted(() => vi.fn());
const createSweeperTxsMock = vi.hoisted(() => vi.fn());
const performDestinationSwapMock = vi.hoisted(() => vi.fn());
const createSafeExecuteEOASubmittedTxMock = vi.hoisted(() => vi.fn());
const createSafeExecuteTxFromCallsMock = vi.hoisted(() => vi.fn());
const createSBCTxFromCallsMock = vi.hoisted(() => vi.fn());
const caliburExecuteMock = vi.hoisted(() => vi.fn());
const checkAuthCodeSetMock = vi.hoisted(() => vi.fn());
const waitForSBCTxReceiptMock = vi.hoisted(() => vi.fn());
const switchChainMock = vi.hoisted(() => vi.fn());
const waitForTxReceiptMock = vi.hoisted(() => vi.fn());
const getFeeStoreMock = vi.hoisted(() => vi.fn());
const getAllowancesMock = vi.hoisted(() => vi.fn());
const createRFFromIntentMock = vi.hoisted(() => vi.fn());
const cosmosCreateRFFMock = vi.hoisted(() => vi.fn());
const cosmosCreateDoubleCheckTxMock = vi.hoisted(() => vi.fn());
const evmWaitForFillMock = vi.hoisted(() => vi.fn());
const storeIntentHashToStoreMock = vi.hoisted(() => vi.fn());
const removeIntentHashFromStoreMock = vi.hoisted(() => vi.fn());
const createPublicClientMock = vi.hoisted(() => vi.fn());
const pipelineEvents = vi.hoisted((): string[] => []);

vi.mock('../../../src/swap/route', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/swap/route')>('../../../src/swap/route');
  return {
    ...actual,
    determineSwapRoute: determineSwapRouteMock,
  };
});

vi.mock('../../../src/swap/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/swap/utils')>('../../../src/swap/utils');
  return {
    ...actual,
    createPermitAndTransferFromTx: createPermitAndTransferFromTxMock,
    createPermitOnlyApprovalTx: createPermitOnlyApprovalTxMock,
    createSweeperTxs: createSweeperTxsMock,
    performDestinationSwap: performDestinationSwapMock,
  };
});

vi.mock('../../../src/swap/sbc', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/swap/sbc')>('../../../src/swap/sbc');
  return {
    ...actual,
    caliburExecute: caliburExecuteMock,
    checkAuthCodeSet: checkAuthCodeSetMock,
    createSBCTxFromCalls: createSBCTxFromCallsMock,
    waitForSBCTxReceipt: waitForSBCTxReceiptMock,
  };
});

vi.mock('../../../src/swap/safetx', async () => {
  const actual = await vi.importActual<typeof import('../../../src/swap/safetx')>(
    '../../../src/swap/safetx'
  );
  return {
    ...actual,
    createSafeExecuteEOASubmittedTx: createSafeExecuteEOASubmittedTxMock,
    createSafeExecuteTxFromCalls: createSafeExecuteTxFromCallsMock,
  };
});

vi.mock('../../../src/core/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/core/utils')>('../../../src/core/utils');
  return {
    ...actual,
    cosmosCreateDoubleCheckTx: cosmosCreateDoubleCheckTxMock,
    cosmosCreateRFF: cosmosCreateRFFMock,
    createRFFromIntent: createRFFromIntentMock,
    evmWaitForFill: evmWaitForFillMock,
    getAllowances: getAllowancesMock,
    getFeeStore: getFeeStoreMock,
    removeIntentHashFromStore: removeIntentHashFromStoreMock,
    storeIntentHashToStore: storeIntentHashToStoreMock,
    switchChain: switchChainMock,
    waitForTxReceipt: waitForTxReceiptMock,
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
  };
});

describe('swap pipeline characterization', () => {
  const EPHEMERAL_ADDRESS = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
  const EPHEMERAL_SAFE_ADDRESS = predictSafeAccountAddress(EPHEMERAL_ADDRESS);

  const createSourceQuote = (
    chainID: number,
    inputToken: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    outputToken: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ) =>
    ({
      chainID,
      holding: {
        amountRaw: 1_000_000n,
        tokenAddress: convertTo32Bytes(inputToken),
      },
      quote: {
        input: {
          amount: '1',
          amountRaw: 1_000_000n,
          contractAddress: inputToken,
          decimals: equalFold(inputToken, EADDRESS) ? 18 : 6,
          symbol: equalFold(inputToken, EADDRESS) ? 'ETH' : 'USDC',
        },
        output: {
          amount: '1',
          amountRaw: 1_000_000n,
          contractAddress: outputToken,
          decimals: 6,
          symbol: 'USDC',
        },
        txData: {
          approvalAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
          tx: {
            data: '0x1234',
            to: '0xdddddddddddddddddddddddddddddddddddddddd',
            value: '0',
          },
        },
      },
    }) as never;

  const makeExecution = (
    mode: '7702' | 'safe_account' | 'direct_eoa',
    address: Hex,
    entryPoint: Hex | null = null,
    factoryAddress: Hex | null = mode === 'safe_account'
      ? '0x4444444444444444444444444444444444444444'
      : null
  ) => ({
    address,
    entryPoint,
    factoryAddress,
    mode,
  });

  const createBridgeAsset = (chainID: number, amount = '1') => ({
    chainID,
    contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
    decimals: 6,
    eoaBalance: new Decimal(0),
    ephemeralBalance: new Decimal(amount),
  });

  const baseRoute = (overrides: Partial<Record<string, unknown>> = {}) =>
    ({
      type: 'EXACT_IN' as const,
      source: {
        creationTime: 1,
        executions: {},
        swaps: [],
      },
      bridge: null,
      destination: {
        chainId: SUPPORTED_CHAINS.BASE,
        eoaToDestinationAccount: null,
        execution: makeExecution('direct_eoa', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', null),
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
        contractAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
        decimals: 6,
        name: 'USD Coin',
        symbol: 'USDC',
      },
      extras: {
        aggregators: [],
        assetsUsed: [],
        balances: [],
        oraclePrices: {},
      },
      ...overrides,
    }) as never;

  const makeBalance = (chainID: number, tokenAddress: Hex, amount = '1') => ({
    amount,
    chainID,
    decimals: equalFold(tokenAddress, ZERO_ADDRESS) ? 18 : 6,
    logo: '',
    symbol: equalFold(tokenAddress, ZERO_ADDRESS) ? 'ETH' : 'USDC',
    tokenAddress: toHex(convertTo32Bytes(tokenAddress)),
    universe: Universe.ETHEREUM,
    value: Number(amount),
  });

  const pad32 = (value: Hex) => toHex(convertTo32Bytes(value));

  const chainList = () => ({
    getChainByID: vi.fn((id: number) => {
      if (
        id !== SUPPORTED_CHAINS.BASE &&
        id !== SUPPORTED_CHAINS.ARBITRUM &&
        id !== SUPPORTED_CHAINS.HYPEREVM
      ) {
        return undefined;
      }

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
        rpcUrls: {
          default: {
            http: ['https://rpc.example'],
            webSocket: ['wss://rpc.example'],
          },
        },
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

  const makeOptions = (vscClientOverrides: Record<string, unknown> = {}) => {
    const vscClient = {
      vscCreateSafeExecuteTx: vi.fn(async (request: { chainId: number; chainID?: number }) => {
        const chainID = request.chainId ?? request.chainID;
        pipelineEvents.push(`vscSafe:${chainID}`);
        return [BigInt(chainID), `0x${'11'.repeat(32)}`];
      }),
      vscEnsureSafeAccount: vi.fn(async ({ chainId }) => {
        pipelineEvents.push(`ensure:${chainId}`);
        return {
          address: EPHEMERAL_SAFE_ADDRESS,
          deployTxHash: null,
          exists: true,
        };
      }),
      vscSBCTx: vi.fn(async (requests: Array<{ chainID: number }>) => {
        pipelineEvents.push(`vscSbc:${requests.map((request) => request.chainID).join(',')}`);
        return requests.map((request, index) => [
          BigInt(request.chainID),
          `0x${`${index + 1}`.repeat(64)}` as Hex,
        ]);
      }),
      ...vscClientOverrides,
    };

    return {
      options: {
        address: {
          cosmos: 'avail1characterization',
          eoa: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          ephemeral: EPHEMERAL_ADDRESS,
        },
        chainList: chainList(),
        cosmosQueryClient: {} as never,
        intentExplorerUrl: 'https://intent.example',
        onSwapIntent: ({ allow }) => allow(),
        vscClient: vscClient as never,
        wallet: {
          cosmos: {} as never,
          eoa: {} as never,
          ephemeral: {
            address: EPHEMERAL_ADDRESS,
            sign: vi.fn(async () => `0x${'99'.repeat(65)}`),
          } as never,
        },
      },
      vscClient,
    };
  };

  const runScenario = async (
    route: ReturnType<typeof baseRoute>,
    bridgeSources: Array<{ chainID: number; tokenAddress: Hex; valueRaw: bigint }>,
    allowanceByChain: Record<number, bigint>,
    vscClientOverrides: Record<string, unknown> = {}
  ) => {
    determineSwapRouteMock.mockResolvedValue(route);
    getAllowancesMock.mockResolvedValue(allowanceByChain);
    createRFFromIntentMock.mockImplementation(async () => ({
      msgBasicCosmos: {},
      omniversalRFF: {
        asEVMRFF: () => ({
          sources: bridgeSources.map((source) => ({
            universe: Universe.ETHEREUM,
            chainID: BigInt(source.chainID),
            contractAddress: pad32(source.tokenAddress),
            value: source.valueRaw,
          })),
          destinationUniverse: Universe.ETHEREUM,
          destinationChainID: BigInt(route.destination.chainId),
          recipientAddress: pad32('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
          destinations: [
            {
              contractAddress: pad32(route.dstTokenInfo.contractAddress),
              value: 1_000_000n,
            },
          ],
          nonce: 1n,
          expiry: 1n,
          parties: [
            {
              universe: Universe.ETHEREUM,
              address_: pad32('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
            },
          ],
        }),
        protobufRFF: {
          sources: bridgeSources.map((source) => ({
            chainID: new Uint8Array([source.chainID]),
          })),
        },
      },
      signatureData: [
        {
          requestHash: new Uint8Array(32),
          signature: new Uint8Array([1, 2, 3]),
          universe: Universe.ETHEREUM,
        },
      ],
      sources: bridgeSources,
    }));

    const { options, vscClient } = makeOptions(vscClientOverrides);
    const firstSource =
      route.extras.assetsUsed[0] ??
      ({
        chainID: SUPPORTED_CHAINS.ARBITRUM,
        contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      } as const);

    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        from: [
          {
            amount: 1_000_000n,
            chainId: firstSource.chainID,
            tokenAddress: firstSource.contractAddress,
          },
        ],
        toChainId: route.destination.chainId,
        toTokenAddress: route.dstTokenInfo.contractAddress,
      },
    };

    const result = await swap(input, options);
    return { result, vscClient };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pipelineEvents.length = 0;

    createPublicClientMock.mockImplementation(() => ({
      estimateGas: vi.fn(async () => 100_000n),
      getCode: vi.fn(async () => '0x'),
      getTransactionCount: vi.fn(async () => 0n),
      readContract: vi.fn(async ({ functionName }) => {
        switch (functionName) {
          case 'DOMAIN_SEPARATOR':
            return `0x${'01'.repeat(32)}`;
          case 'allowance':
          case 'nativeAllowance':
          case 'nonces':
            return 0n;
          case 'name':
            return 'USD Coin';
          case 'version':
            return '1';
          default:
            return 0n;
        }
      }),
      request: vi.fn(),
    }));
    createPermitAndTransferFromTxMock.mockImplementation(async () => {
      pipelineEvents.push('permitTransfer');
      return [
        {
          data: '0xpermittransfer',
          to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          value: 0n,
        },
      ];
    });
    createPermitOnlyApprovalTxMock.mockImplementation(async () => {
      pipelineEvents.push('permitOnly');
      return {
        data: '0xpermitonly',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        value: 0n,
      };
    });
    createSweeperTxsMock.mockReturnValue([]);
    performDestinationSwapMock.mockImplementation(async () => {
      pipelineEvents.push('destination.perform');
      return `0x${'77'.repeat(32)}`;
    });
    createSafeExecuteEOASubmittedTxMock.mockImplementation(async ({ safeAddress }) => {
      pipelineEvents.push(`walletSafe:${safeAddress}`);
      return `0x${'88'.repeat(32)}`;
    });
    createSafeExecuteTxFromCallsMock.mockImplementation(async ({ chainId, calls }) => ({
      chainId,
      calls,
    }));
    createSBCTxFromCallsMock.mockImplementation(async ({ chainID, calls }) => ({
      chainID,
      calls,
    }));
    caliburExecuteMock.mockImplementation(async ({ targetAddress }) => {
      pipelineEvents.push(`walletSafe:${targetAddress}`);
      return `0x${'88'.repeat(32)}`;
    });
    checkAuthCodeSetMock.mockResolvedValue(true);
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
    switchChainMock.mockResolvedValue(undefined);
    waitForTxReceiptMock.mockResolvedValue(undefined);
    getFeeStoreMock.mockResolvedValue({
      calculateCollectionFee: () => new Decimal(0),
      calculateFulfilmentFee: () => new Decimal(0),
      calculateProtocolFee: () => new Decimal(0),
      calculateSolverFee: () => new Decimal(0),
    });
    cosmosCreateRFFMock.mockImplementation(async () => {
      pipelineEvents.push('cosmosCreateRFF');
      return Long.fromNumber(42);
    });
    cosmosCreateDoubleCheckTxMock.mockResolvedValue(undefined);
    evmWaitForFillMock.mockResolvedValue(undefined);
  });

  it('runs a Safe source swap plus bridge through the real handlers and ensures before source execution', async () => {
    const execution = makeExecution('safe_account', EPHEMERAL_SAFE_ADDRESS);
    const route = baseRoute({
      source: {
        creationTime: 1,
        executions: {
          [SUPPORTED_CHAINS.HYPEREVM]: execution,
        },
        swaps: [createSourceQuote(SUPPORTED_CHAINS.HYPEREVM)],
      },
      bridge: {
        amount: new Decimal(1),
        assets: [createBridgeAsset(SUPPORTED_CHAINS.HYPEREVM)],
        chainID: SUPPORTED_CHAINS.BASE,
        decimals: 6,
        estimatedFees: { caGas: '0', gasSupplied: '0', protocol: '0', solver: '0' },
        recipientAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        tokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
      },
      extras: {
        aggregators: [],
        assetsUsed: [
          {
            amount: '1',
            chainID: SUPPORTED_CHAINS.HYPEREVM,
            contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
            decimals: 6,
            symbol: 'USDC',
          },
        ],
        balances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        ],
        oraclePrices: {},
      },
    });

    const { vscClient } = await runScenario(
      route,
      [
        {
          chainID: SUPPORTED_CHAINS.HYPEREVM,
          tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          valueRaw: 1_000_000n,
        },
      ],
      { [SUPPORTED_CHAINS.HYPEREVM]: 0n }
    );

    expect(pipelineEvents.indexOf(`ensure:${SUPPORTED_CHAINS.HYPEREVM}`)).toBeLessThan(
      pipelineEvents.indexOf(`vscSafe:${SUPPORTED_CHAINS.HYPEREVM}`)
    );
    expect(vscClient.vscEnsureSafeAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: SUPPORTED_CHAINS.HYPEREVM,
        owner: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        safeAddress: EPHEMERAL_SAFE_ADDRESS,
        saltNonce: SAFE_SALT_NONCE,
        signature: `0x${'99'.repeat(65)}`,
        deadline: expect.anything(),
      })
    );
    expect(typeof vi.mocked(vscClient.vscEnsureSafeAccount).mock.calls[0]?.[0]?.deadline).toBe(
      'bigint'
    );
    expect(
      pipelineEvents.filter((event) => event === `vscSafe:${SUPPORTED_CHAINS.HYPEREVM}`)
    ).toHaveLength(2);
    expect(cosmosCreateRFFMock).toHaveBeenCalledTimes(1);
  });

  it('bridges Safe-held COT without any source swap step', async () => {
    const execution = makeExecution('safe_account', EPHEMERAL_SAFE_ADDRESS);
    const route = baseRoute({
      source: {
        creationTime: 1,
        executions: {
          [SUPPORTED_CHAINS.HYPEREVM]: execution,
        },
        swaps: [],
      },
      bridge: {
        amount: new Decimal(1),
        assets: [createBridgeAsset(SUPPORTED_CHAINS.HYPEREVM)],
        chainID: SUPPORTED_CHAINS.BASE,
        decimals: 6,
        estimatedFees: { caGas: '0', gasSupplied: '0', protocol: '0', solver: '0' },
        recipientAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        tokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
      },
    });

    await runScenario(
      route,
      [
        {
          chainID: SUPPORTED_CHAINS.HYPEREVM,
          tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          valueRaw: 1_000_000n,
        },
      ],
      { [SUPPORTED_CHAINS.HYPEREVM]: 0n }
    );

    expect(pipelineEvents).not.toContain(`vscSbc:${SUPPORTED_CHAINS.HYPEREVM}`);
    expect(
      pipelineEvents.filter((event) => event === `vscSafe:${SUPPORTED_CHAINS.HYPEREVM}`)
    ).toHaveLength(1);
    expect(cosmosCreateRFFMock).toHaveBeenCalledTimes(1);
  });

  it('skips the Safe vault permit when the ephemeral allowance is already sufficient', async () => {
    const execution = makeExecution('safe_account', EPHEMERAL_SAFE_ADDRESS);
    const route = baseRoute({
      source: {
        creationTime: 1,
        executions: {
          [SUPPORTED_CHAINS.HYPEREVM]: execution,
        },
        swaps: [],
      },
      bridge: {
        amount: new Decimal(1),
        assets: [createBridgeAsset(SUPPORTED_CHAINS.HYPEREVM)],
        chainID: SUPPORTED_CHAINS.BASE,
        decimals: 6,
        estimatedFees: { caGas: '0', gasSupplied: '0', protocol: '0', solver: '0' },
        recipientAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        tokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
      },
    });

    await runScenario(
      route,
      [
        {
          chainID: SUPPORTED_CHAINS.HYPEREVM,
          tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          valueRaw: 1_000_000n,
        },
      ],
      { [SUPPORTED_CHAINS.HYPEREVM]: 1_000_000n }
    );

    expect(createPermitOnlyApprovalTxMock).not.toHaveBeenCalled();
    expect(cosmosCreateRFFMock).toHaveBeenCalledTimes(1);
  });

  it('aborts before any cosmos broadcast when bridge permit construction fails after a Safe source swap', async () => {
    const execution = makeExecution('safe_account', EPHEMERAL_SAFE_ADDRESS);
    const route = baseRoute({
      source: {
        creationTime: 1,
        executions: {
          [SUPPORTED_CHAINS.HYPEREVM]: execution,
        },
        swaps: [createSourceQuote(SUPPORTED_CHAINS.HYPEREVM)],
      },
      bridge: {
        amount: new Decimal(1),
        assets: [createBridgeAsset(SUPPORTED_CHAINS.HYPEREVM)],
        chainID: SUPPORTED_CHAINS.BASE,
        decimals: 6,
        estimatedFees: { caGas: '0', gasSupplied: '0', protocol: '0', solver: '0' },
        recipientAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        tokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
      },
      extras: {
        aggregators: [],
        assetsUsed: [
          {
            amount: '1',
            chainID: SUPPORTED_CHAINS.HYPEREVM,
            contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
            decimals: 6,
            symbol: 'USDC',
          },
        ],
        balances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        ],
        oraclePrices: {},
      },
    });
    createPermitOnlyApprovalTxMock.mockRejectedValueOnce(new Error('permit failed'));

    await expect(
      runScenario(
        route,
        [
          {
            chainID: SUPPORTED_CHAINS.HYPEREVM,
            tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            valueRaw: 1_000_000n,
          },
        ],
        { [SUPPORTED_CHAINS.HYPEREVM]: 0n }
      )
    ).rejects.toThrow('permit failed');

    expect(cosmosCreateRFFMock).not.toHaveBeenCalled();
    expect(
      pipelineEvents.filter((event) => event === `vscSafe:${SUPPORTED_CHAINS.HYPEREVM}`)
    ).toHaveLength(1);
  });

  it('hands off same-chain Safe source output to the destination execution when no bridge is needed', async () => {
    const execution = makeExecution('safe_account', EPHEMERAL_SAFE_ADDRESS);
    const route = baseRoute({
      source: {
        creationTime: 1,
        executions: {
          [SUPPORTED_CHAINS.HYPEREVM]: execution,
        },
        swaps: [createSourceQuote(SUPPORTED_CHAINS.HYPEREVM)],
      },
      destination: {
        chainId: SUPPORTED_CHAINS.HYPEREVM,
        eoaToDestinationAccount: null,
        execution,
        getDstSwap: vi.fn(async () => null),
        inputAmount: { max: new Decimal(1), min: new Decimal(1) },
        swap: {
          creationTime: 1,
          gasSwap: null,
          tokenSwap: null,
        },
      },
      extras: {
        aggregators: [],
        assetsUsed: [
          {
            amount: '1',
            chainID: SUPPORTED_CHAINS.HYPEREVM,
            contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
            decimals: 6,
            symbol: 'USDC',
          },
        ],
        balances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        ],
        oraclePrices: {},
      },
    });

    await runScenario(route, [], {});

    expect(performDestinationSwapMock).toHaveBeenCalledTimes(1);
    expect(cosmosCreateRFFMock).not.toHaveBeenCalled();
    expect(
      pipelineEvents.filter((event) => event === `ensure:${SUPPORTED_CHAINS.HYPEREVM}`)
    ).toHaveLength(1);
  });

  it('ensures a shared same-chain Safe execution exactly once even when a destination swap is required', async () => {
    const execution = makeExecution('safe_account', EPHEMERAL_SAFE_ADDRESS);
    const route = baseRoute({
      source: {
        creationTime: 1,
        executions: {
          [SUPPORTED_CHAINS.HYPEREVM]: execution,
        },
        swaps: [createSourceQuote(SUPPORTED_CHAINS.HYPEREVM)],
      },
      destination: {
        chainId: SUPPORTED_CHAINS.HYPEREVM,
        eoaToDestinationAccount: null,
        execution,
        getDstSwap: vi.fn(async () => ({
          creationTime: Date.now(),
          gasSwap: {
            quote: {
              input: {
                amount: '1',
                amountRaw: 1_000_000n,
                contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                decimals: 6,
                symbol: 'USDC',
              },
              output: {
                amount: '0.0001',
                amountRaw: 100_000_000_000_000n,
                contractAddress: ZERO_ADDRESS,
                decimals: 18,
                symbol: 'ETH',
              },
              txData: {
                approvalAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
                tx: {
                  data: '0x5678',
                  to: '0xdddddddddddddddddddddddddddddddddddddddd',
                  value: '0',
                },
              },
            },
          },
          tokenSwap: null,
        })),
        inputAmount: { max: new Decimal(1), min: new Decimal(1) },
        swap: {
          creationTime: Date.now(),
          gasSwap: {
            quote: {
              input: {
                amount: '1',
                amountRaw: 1_000_000n,
                contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                decimals: 6,
                symbol: 'USDC',
              },
              output: {
                amount: '0.0001',
                amountRaw: 100_000_000_000_000n,
                contractAddress: ZERO_ADDRESS,
                decimals: 18,
                symbol: 'ETH',
              },
              txData: {
                approvalAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
                tx: {
                  data: '0x5678',
                  to: '0xdddddddddddddddddddddddddddddddddddddddd',
                  value: '0',
                },
              },
            },
          },
          tokenSwap: null,
        },
      },
      extras: {
        aggregators: [],
        assetsUsed: [
          {
            amount: '1',
            chainID: SUPPORTED_CHAINS.HYPEREVM,
            contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
            decimals: 6,
            symbol: 'USDC',
          },
        ],
        balances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        ],
        oraclePrices: {},
      },
    });

    await runScenario(route, [], {});

    expect(
      pipelineEvents.filter((event) => event === `ensure:${SUPPORTED_CHAINS.HYPEREVM}`)
    ).toHaveLength(1);
    expect(performDestinationSwapMock).toHaveBeenCalledTimes(1);
  });

  it('runs mixed 7702 and Safe sources through their respective submission paths', async () => {
    const safeExecution = makeExecution('safe_account', EPHEMERAL_SAFE_ADDRESS);
    const delegatedExecution = makeExecution(
      '7702',
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      null
    );
    const route = baseRoute({
      source: {
        creationTime: 1,
        executions: {
          [SUPPORTED_CHAINS.HYPEREVM]: safeExecution,
          [SUPPORTED_CHAINS.ARBITRUM]: delegatedExecution,
        },
        swaps: [
          createSourceQuote(SUPPORTED_CHAINS.HYPEREVM),
          createSourceQuote(SUPPORTED_CHAINS.ARBITRUM),
        ],
      },
      bridge: {
        amount: new Decimal(2),
        assets: [
          createBridgeAsset(SUPPORTED_CHAINS.HYPEREVM),
          createBridgeAsset(SUPPORTED_CHAINS.ARBITRUM),
        ],
        chainID: SUPPORTED_CHAINS.BASE,
        decimals: 6,
        estimatedFees: { caGas: '0', gasSupplied: '0', protocol: '0', solver: '0' },
        recipientAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        tokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
      },
      extras: {
        aggregators: [],
        assetsUsed: [
          {
            amount: '1',
            chainID: SUPPORTED_CHAINS.HYPEREVM,
            contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
            decimals: 6,
            symbol: 'USDC',
          },
          {
            amount: '1',
            chainID: SUPPORTED_CHAINS.ARBITRUM,
            contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
            decimals: 6,
            symbol: 'USDC',
          },
        ],
        balances: [
          makeBalance(SUPPORTED_CHAINS.HYPEREVM, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
          makeBalance(SUPPORTED_CHAINS.ARBITRUM, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        ],
        oraclePrices: {},
      },
    });

    await runScenario(
      route,
      [
        {
          chainID: SUPPORTED_CHAINS.HYPEREVM,
          tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          valueRaw: 1_000_000n,
        },
        {
          chainID: SUPPORTED_CHAINS.ARBITRUM,
          tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          valueRaw: 1_000_000n,
        },
      ],
      {
        [SUPPORTED_CHAINS.HYPEREVM]: 0n,
        [SUPPORTED_CHAINS.ARBITRUM]: 0n,
      }
    );

    expect(
      pipelineEvents.filter((event) => event === `ensure:${SUPPORTED_CHAINS.HYPEREVM}`)
    ).toHaveLength(1);
    expect(
      pipelineEvents.filter((event) => event === `vscSafe:${SUPPORTED_CHAINS.HYPEREVM}`)
    ).toHaveLength(2);
    expect(
      pipelineEvents.filter((event) => event === `vscSbc:${SUPPORTED_CHAINS.ARBITRUM}`)
    ).toHaveLength(2);
  });
});
