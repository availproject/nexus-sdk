// TODO: rebaseline characterization snapshots after the smart-account-only refactor
//   (WalletPath = ephemeral | safe; no more SwapWalletMode / finalWalletPath /
//    bridgeFundingWalletPath / sourceRecipientWalletPath). describe() is .skip'd until
//   each scenario's expected execution paths, fee math, sendCalls counts, and
//   eoaToEphemeralTransfers are recomputed for the new model.
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatUnits, parseUnits, type Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type {
  ChainListType,
  SwapAndExecuteEvent,
  TokenInfo,
} from '../../../src';
import { swapAndExecute } from '../../../src/flows/swap-and-execute';
import { EADDRESS } from '../../../src/swap/constants';
import { Universe } from '../../../src/domain/chain-abstraction';
import { makeSwapMiddlewareClient } from '../../helpers/middleware-client';
import { makeSwapChainList, ARB_CHAIN, USDC_ARB } from '../../helpers/swap';

const hoisted = vi.hoisted(() => {
  const readContract = vi.fn();
  const multicall = vi.fn();
  const getCode = vi.fn();
  const getTransactionCount = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const simulateContract = vi.fn();
  const watchContractEvent = vi.fn();
  const getFeeHistory = vi.fn();

  const createPublicClient = vi.fn((options?: { chain?: unknown }) => ({
    chain: options?.chain,
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    simulateContract,
    watchContractEvent,
    getFeeHistory,
  }));

  return {
    createPublicClient,
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    simulateContract,
    watchContractEvent,
    getFeeHistory,
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: hoisted.createPublicClient,
    http: vi.fn().mockReturnValue({}),
    fallback: vi.fn().mockReturnValue({}),
  };
});

const SOURCE_DAI = '0x0000000000000000000000000000000000000da1' as Hex;
const NATIVE = EADDRESS as Hex;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex;
const USER_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Hex;
const TARGET_CONTRACT = '0x3333333333333333333333333333333333333333' as Hex;
const SWAP_TX_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;
const EXECUTE_TX_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex;

const usdcToken: TokenInfo = {
  contractAddress: USDC_ARB,
  decimals: 6,
  symbol: 'USDC',
  name: 'USD Coin',
  logo: '',
};

const nativeToken: TokenInfo = {
  contractAddress: NATIVE,
  decimals: 18,
  symbol: 'ETH',
  name: 'Ether',
  logo: '',
};

const daiToken: TokenInfo = {
  contractAddress: SOURCE_DAI,
  decimals: 18,
  symbol: 'DAI',
  name: 'Dai Stablecoin',
  logo: '',
};

const oraclePrices = [
  {
    universe: 'EVM' as const,
    chainId: ARB_CHAIN,
    tokenAddress: USDC_ARB,
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    priceUsd: new Decimal(1),
    timestamp: 1,
  },
  {
    universe: 'EVM' as const,
    chainId: ARB_CHAIN,
    tokenAddress: ZERO_ADDRESS,
    tokenSymbol: 'ETH',
    tokenDecimals: 18,
    priceUsd: new Decimal(3000),
    timestamp: 1,
  },
];

const rateKey = (inputToken: Hex, outputToken: Hex) =>
  `${ARB_CHAIN}:${inputToken.toLowerCase()}:${outputToken.toLowerCase()}`;

const RATES: Record<'lifi' | 'bebop', Record<string, Decimal>> = {
  lifi: {
    [rateKey(SOURCE_DAI, USDC_ARB)]: new Decimal('0.72'),
    [rateKey(NATIVE, USDC_ARB)]: new Decimal('3000'),
  },
  bebop: {
    [rateKey(SOURCE_DAI, USDC_ARB)]: new Decimal('0.8'),
    [rateKey(NATIVE, USDC_ARB)]: new Decimal('2900'),
  },
};

const getRate = (aggregator: 'lifi' | 'bebop', inputToken: Hex, outputToken: Hex) => {
  const rate = RATES[aggregator][rateKey(inputToken, outputToken)];
  if (!rate) {
    throw new Error(`Missing ${aggregator} rate for ${inputToken}:${outputToken}`);
  }
  return rate;
};

const createSwapAndExecuteQuery = (input: {
  chainList: ChainListType;
  evmClient: {
    sendTransaction: (...args: unknown[]) => Promise<Hex>;
  };
  middlewareClient: ReturnType<typeof makeSwapMiddlewareClient>;
  ephemeralWallet: PrivateKeyAccount;
  eoaAddress: Hex;
  skipSwapOverride?: boolean;
}) => {
  const deps = {
    chainList: input.chainList,
    middlewareClient: input.middlewareClient,
    intentExplorerUrl: 'https://intent.example',
    evm: {
      walletClient: input.evmClient as never,
      address: input.eoaAddress,
    },
    swap: {
      ephemeralWallet: input.ephemeralWallet,
      cotCurrencyId: 1,
    },
  };

  return {
    swapAndExecute: (
      params: Parameters<typeof swapAndExecute>[0],
      options?: Parameters<typeof swapAndExecute>[2]
    ) =>
      swapAndExecute(params, deps, {
        ...options,
        skipSwapOverride: input.skipSwapOverride ?? options?.skipSwapOverride,
      }),
  };
};

const toRawAmount = (amount: Decimal, decimals: number) =>
  parseUnits(amount.toFixed(decimals), decimals);

const fromRawAmount = (amountRaw: bigint, decimals: number) =>
  new Decimal(formatUnits(amountRaw, decimals));

const makeLiFiResponse = (params: Record<string, string>, exactOut = false) => {
  const inputToken = params.fromToken as Hex;
  const outputToken = params.toToken as Hex;
  const inputMeta = inputToken.toLowerCase() === SOURCE_DAI.toLowerCase() ? daiToken : nativeToken;
  const outputMeta = usdcToken;
  const rate = getRate('lifi', inputToken, outputToken);

  const outputAmountHuman = exactOut
    ? fromRawAmount(BigInt(params.toAmount), outputMeta.decimals)
    : fromRawAmount(BigInt(params.fromAmount), inputMeta.decimals).mul(rate);
  const inputAmountHuman = exactOut
    ? outputAmountHuman.div(rate)
    : fromRawAmount(BigInt(params.fromAmount), inputMeta.decimals);

  const inputAmountRaw = toRawAmount(inputAmountHuman, inputMeta.decimals);
  const outputAmountRaw = toRawAmount(outputAmountHuman, outputMeta.decimals);

  return {
    estimate: {
      fromAmount: inputAmountRaw.toString(),
      fromAmountUSD: inputAmountHuman.toFixed(2),
      toAmount: outputAmountRaw.toString(),
      toAmountMin: outputAmountRaw.toString(),
      toAmountUSD: outputAmountHuman.toFixed(2),
      approvalAddress: '0x1111111111111111111111111111111111111111',
      feeCosts: [],
      gasCosts: [],
    },
    action: {
      fromToken: {
        address: inputToken,
        symbol: inputMeta.symbol,
        decimals: inputMeta.decimals,
        priceUSD: '1',
      },
      toToken: {
        address: outputToken,
        symbol: outputMeta.symbol,
        decimals: outputMeta.decimals,
        priceUSD: '1',
      },
    },
    transactionRequest: {
      to: '0x1111111111111111111111111111111111112222',
      data: '0xabcdef',
      value: '0x0',
    },
  };
};

const makeBebopResponse = (params: Record<string, string>) => {
  const inputToken = params.sell_tokens as Hex;
  const outputToken = params.buy_tokens as Hex;
  const inputMeta = inputToken.toLowerCase() === SOURCE_DAI.toLowerCase() ? daiToken : nativeToken;
  const outputMeta = usdcToken;
  const rate = getRate('bebop', inputToken, outputToken);
  const isExactOut = params.buy_tokens_amounts !== undefined;

  const outputAmountHuman = isExactOut
    ? fromRawAmount(BigInt(params.buy_tokens_amounts), outputMeta.decimals)
    : fromRawAmount(BigInt(params.sell_amounts), inputMeta.decimals).mul(rate);
  const inputAmountHuman = isExactOut
    ? outputAmountHuman.div(rate)
    : fromRawAmount(BigInt(params.sell_amounts), inputMeta.decimals);

  const inputAmountRaw = toRawAmount(inputAmountHuman, inputMeta.decimals);
  const outputAmountRaw = toRawAmount(outputAmountHuman, outputMeta.decimals);

  return {
    routes: [
      {
        quote: {
          buyTokens: {
            [outputToken]: {
              minimumAmount: outputAmountRaw.toString(),
              priceUsd: 1,
              symbol: outputMeta.symbol,
              decimals: outputMeta.decimals,
            },
          },
          sellTokens: {
            [inputToken]: {
              amount: inputAmountRaw.toString(),
              priceUsd: inputMeta.symbol === 'DAI' ? 1 : 3000,
              symbol: inputMeta.symbol,
              decimals: inputMeta.decimals,
            },
          },
        },
        approvalTarget: '0x2222222222222222222222222222222222221111',
        tx: {
          to: '0x2222222222222222222222222222222222222222',
          data: '0xfedcba',
          value: '0x0',
        },
        expiry: Math.floor(Date.now() / 1000) + 60,
      },
    ],
  };
};

const makeChainList = (): ChainListType => {
  const chainList = makeSwapChainList();
  const originalGetChainByID = chainList.getChainByID;
  const originalGetTokenByAddress = chainList.getTokenByAddress;

  chainList.getChainByID = vi.fn().mockImplementation((chainId: number) => {
    const chain = originalGetChainByID(chainId);
    return {
      ...chain,
      name: 'Arbitrum',
      supports7702: true,
      universe: Universe.ETHEREUM,
      nativeCurrency: { ...chain.nativeCurrency, symbol: 'ETH', name: 'Ether', logo: '' },
      blockExplorers: { default: { name: 'Arbiscan', url: 'https://arbiscan.io' } },
      custom: { ...chain.custom, icon: 'https://arb.example/icon.png' },
    };
  });
  chainList.getTokenByAddress = vi.fn().mockImplementation((chainId: number, tokenAddress: Hex) => {
    if (tokenAddress.toLowerCase() === SOURCE_DAI.toLowerCase()) {
      return daiToken;
    }
    if (tokenAddress.toLowerCase() === NATIVE.toLowerCase()) {
      return nativeToken;
    }
    return originalGetTokenByAddress(chainId, tokenAddress);
  });
  chainList.getNativeToken = vi.fn().mockReturnValue(nativeToken);
  return chainList;
};

const makeEvmClient = () => {
  let currentChainId = ARB_CHAIN;

  return {
    getChainId: vi.fn().mockImplementation(async () => currentChainId),
    switchChain: vi.fn().mockImplementation(async ({ id }: { id: number }) => {
      currentChainId = id;
    }),
    addChain: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue({
      42161: { atomic: { status: 'supported' } },
    }),
    sendCalls: vi.fn().mockResolvedValue({ id: '0xcallid' }),
    waitForCallsStatus: vi.fn().mockResolvedValue({
      status: 'success',
      receipts: [{ transactionHash: SWAP_TX_HASH }],
    }),
    sendTransaction: vi.fn().mockResolvedValue(EXECUTE_TX_HASH),
    writeContract: vi.fn(),
    request: vi.fn().mockResolvedValue('0xa4b1'),
  };
};

const makeEphemeralWallet = (): PrivateKeyAccount =>
  ({
    address: '0xbbbb000000000000000000000000000000000002' as Hex,
    signMessage: vi.fn().mockResolvedValue('0x' + '33'.repeat(65)),
    signTypedData: vi.fn().mockResolvedValue('0x' + '33'.repeat(65)),
    signAuthorization: vi.fn().mockResolvedValue({
      r: '0x01',
      s: '0x02',
      yParity: 0,
      nonce: 0,
    }),
  }) as unknown as PrivateKeyAccount;

const makeMiddlewareClient = (balances: Array<{
  amount: string;
  chainID: number;
  decimals: number;
  name: string;
  logo: string;
  symbol: string;
  tokenAddress: Hex;
  value: number;
}>): Parameters<typeof createSwapAndExecuteQuery>[0]['middlewareClient'] =>
  makeSwapMiddlewareClient({
    getSwapBalances: vi.fn().mockResolvedValue(balances),
    getOraclePrices: vi.fn().mockResolvedValue(oraclePrices),
    getLiFiQuote: vi.fn().mockImplementation(async (params: Record<string, string>, exactOut?: boolean) =>
      makeLiFiResponse(params, exactOut)
    ),
    getBebopQuote: vi.fn().mockImplementation(async (params: Record<string, string>) =>
      makeBebopResponse(params)
    ),
    submitSBCs: vi.fn().mockImplementation(async (txs: Array<{ chainId: number; address: Hex }>) =>
      txs.map((tx, index) => ({
        chainId: tx.chainId,
        address: tx.address,
        errored: false as const,
        txHash: (`0x${(index + 1).toString(16).padStart(64, '0')}`) as Hex,
      }))
    ),
    submitRFF: vi.fn(),
    getRFF: vi.fn(),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'created' }),
  });

const executeOnlyBalances = [
  {
    amount: '200',
    chainID: ARB_CHAIN,
    decimals: 6,
    name: 'USD Coin',
    logo: '',
    symbol: 'USDC',
    tokenAddress: USDC_ARB,
    value: 200,
  },
  {
    amount: '1',
    chainID: ARB_CHAIN,
    decimals: 18,
    name: 'Ether',
    logo: '',
    symbol: 'ETH',
    tokenAddress: NATIVE,
    value: 3000,
  },
];

const fundingRequiredBalances = [
  {
    amount: '200',
    chainID: ARB_CHAIN,
    decimals: 18,
    name: 'Dai Stablecoin',
    logo: '',
    symbol: 'DAI',
    tokenAddress: SOURCE_DAI,
    value: 200,
  },
  {
    amount: '1',
    chainID: ARB_CHAIN,
    decimals: 18,
    name: 'Ether',
    logo: '',
    symbol: 'ETH',
    tokenAddress: NATIVE,
    value: 3000,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'symbol') return 'USDC';
      if (functionName === 'gasEstimateL1Component') return [1n, 1n];
      return 0n;
    }
  );
  hoisted.multicall.mockResolvedValue([]);
  hoisted.getCode.mockResolvedValue(undefined);
  hoisted.getTransactionCount.mockResolvedValue(0);
  hoisted.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
    transactionHash: EXECUTE_TX_HASH,
    blockNumber: 1n,
    effectiveGasPrice: 1n,
    gasUsed: 21_000n,
  });
  hoisted.simulateContract.mockResolvedValue({
    request: {
      to: TARGET_CONTRACT,
      data: '0x',
      value: 0n,
    },
  });
  hoisted.watchContractEvent.mockImplementation(() => () => undefined);
  hoisted.getFeeHistory.mockResolvedValue({
    baseFeePerGas: Array.from({ length: 21 }, () => 1n),
    reward: Array.from({ length: 20 }, () => [1n, 1n, 1n]),
    gasUsedRatio: [],
    oldestBlock: 1n,
  });
});

describe('swapAndExecute pipeline characterization', () => {
  it('keeps the execute-only public flow real and skips nested swap execution when destination balances are sufficient', async () => {
    const evmClient = makeEvmClient();
    const middlewareClient = makeMiddlewareClient(executeOnlyBalances);
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: evmClient as never,
      middlewareClient,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    const events: SwapAndExecuteEvent[] = [];
    const result = await query.swapAndExecute(
      {
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
        toAmountRaw: 100_000_000n,
        execute: {
          to: TARGET_CONTRACT,
          data: '0xdeadbeef' as Hex,
          gas: 100000n,
        },
      },
      {
        onEvent: (event) => {
          events.push(event);
        },
      }
    );

    expect(result).toMatchObject({
      swapSkipped: true,
      swapResult: undefined,
      execute: expect.objectContaining({
        txHash: EXECUTE_TX_HASH,
      }),
    });
    expect(evmClient.sendCalls).not.toHaveBeenCalled();
    expect(evmClient.sendTransaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'preparing' },
        { type: 'status', status: 'route_building' },
        { type: 'status', status: 'route_ready' },
        expect.objectContaining({
          type: 'plan_preview',
          plan: expect.objectContaining({
            swapRequired: false,
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'execute_transaction' }),
            ]),
          }),
        }),
        expect.objectContaining({
          type: 'plan_confirmed',
          plan: expect.objectContaining({
            swapRequired: false,
          }),
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'execute_transaction',
          state: 'confirmed',
        }),
      ])
    );
  });

  it('keeps the nested same-chain funding swap real before executing the destination transaction', async () => {
    const evmClient = makeEvmClient();
    const middlewareClient = makeMiddlewareClient(fundingRequiredBalances);
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: evmClient as never,
      middlewareClient,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    const events: SwapAndExecuteEvent[] = [];
    const result = await query.swapAndExecute(
      {
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
        toAmountRaw: 100_000_000n,
        // Sources now gate gas too, so list native to keep the held ETH covering gas (otherwise the
        // funding swap would also try to acquire gas — a USDC→native swap the mock can't quote).
        sources: [
          {
            chainId: ARB_CHAIN,
            tokenAddress: SOURCE_DAI,
          },
          {
            chainId: ARB_CHAIN,
            tokenAddress: NATIVE,
          },
        ],
        execute: {
          to: TARGET_CONTRACT,
          data: '0xdeadbeef' as Hex,
          gas: 100000n,
        },
      },
      {
        onEvent: (event) => {
          events.push(event);
        },
      }
    );

    expect(result).toMatchObject({
      swapSkipped: false,
      swapResult: expect.objectContaining({
        sourceSwaps: expect.any(Array),
      }),
      execute: expect.objectContaining({
        txHash: EXECUTE_TX_HASH,
      }),
    });
    expect(middlewareClient.getLiFiQuote).toHaveBeenCalled();
    expect(middlewareClient.getBebopQuote).toHaveBeenCalled();
    // Smart-account-only: source swap dispatches via ephemeral SBC (middleware submitSBCs),
    // not EOA sendCalls. Only the final execute lands on the EOA wallet.
    expect(middlewareClient.submitSBCs).toHaveBeenCalled();
    expect(evmClient.sendTransaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'plan_preview',
          plan: expect.objectContaining({
            swapRequired: true,
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'source_swap' }),
              expect.objectContaining({ type: 'execute_transaction' }),
            ]),
          }),
        }),
        expect.objectContaining({
          type: 'plan_confirmed',
          plan: expect.objectContaining({
            swapRequired: true,
          }),
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'source_swap',
          state: 'submitted',
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'source_swap',
          state: 'confirmed',
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'execute_transaction',
          state: 'confirmed',
        }),
        { type: 'status', status: 'completed' },
      ])
    );
  });

  it('fails when a same-chain funding swap would consume reserved destination gas from native source balances', async () => {
    hoisted.getFeeHistory.mockResolvedValue({
      baseFeePerGas: Array.from({ length: 21 }, () => 1_000_000_000n),
      reward: Array.from({ length: 20 }, () => [
        1_000_000_000n,
        1_000_000_000n,
        1_000_000_000n,
      ]),
      gasUsedRatio: [],
      oldestBlock: 1n,
    });

    const evmClient = makeEvmClient();
    const middlewareClient = makeMiddlewareClient([
      {
        amount: '1',
        chainID: ARB_CHAIN,
        decimals: 18,
        name: 'Ether',
        logo: '',
        symbol: 'ETH',
        tokenAddress: NATIVE,
        value: 3000,
      },
    ]);
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: evmClient as never,
      middlewareClient,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await expect(
      query.swapAndExecute({
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
        toAmountRaw: parseUnits('2996.5', 6),
        sources: [
          {
            chainId: ARB_CHAIN,
            tokenAddress: NATIVE,
          },
        ],
        execute: {
          to: TARGET_CONTRACT,
          data: '0xdeadbeef' as Hex,
          gas: 100000n,
        },
      })
    ).rejects.toThrow(/insufficient balance/i);

    expect(middlewareClient.getLiFiQuote).toHaveBeenCalled();
  });
});
