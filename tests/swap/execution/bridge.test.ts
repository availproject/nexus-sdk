import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { decodeFunctionData, encodeFunctionData, erc20Abi, type Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { ERC20PermitABI } from '../../../src/abi/erc20';
import { EVMVaultABI } from '../../../src/abi/vault';
import { getLogger } from '../../../src/domain';
import { ExecutionError } from '../../../src/domain/errors';
import { createEoaToEphemeralTransferStepId } from '../../../src/services/step-ids';

vi.mock('../../../src/services/sbc', () => ({
  createSBCTxFromCalls: vi.fn(),
  createCaliburExecuteTxFromCalls: vi.fn(),
  requireSuccessfulSbcResult: vi.fn((results, chainId) => {
    const result = results.find((entry: { chainId: number }) => entry.chainId === chainId) as
      | { errored: false; txHash: Hex }
      | { errored: true; message: string }
      | undefined;
    if (!result || result.errored) {
      throw new Error(result?.message ?? 'SBC submission failed');
    }
    return result.txHash;
  }),
}));

vi.mock('../../../src/bridge/executor', () => ({
  executeBridgeFromIntent: vi.fn().mockResolvedValue({
    intentExplorerUrl: 'https://explorer.example/rff/0xabc123',
    requestHash: '0xabc123',
    sourceTxs: [],
  }),
  submitRFFToMiddleware: vi.fn().mockResolvedValue('0xabc123'),
  waitForFill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/bridge/hooks/approval', () => ({
  runBridgeHooks: vi.fn().mockImplementation(async (intent) => ({
    intent,
    insufficientAllowanceSources: [],
    allowanceSelections: [],
  })),
}));

vi.mock('../../../src/bridge/allowances/prepare-swap-sbc', () => ({
  prepareSwapBridgeExecution: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/rff', () => ({
  createRequestFromIntent: vi.fn().mockResolvedValue({
    depositRequest: {
      sources: [
        {
          universe: 0,
          chainID: BigInt(42161),
          contractAddress:
            '0x000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831',
          value: 3000000n,
          fee: 0n,
        },
      ],
      destinations: [],
      destinationUniverse: 0,
      destinationChainID: BigInt(8453),
      recipientAddress:
        '0x000000000000000000000000bbbb000000000000000000000000000000000002',
      nonce: 1n,
      expiry: 2n,
      parties: [],
    },
    rffRequest: { sources: [], destinations: [] },
    signature: '0x1234',
    requestHash: '0xabc123',
  }),
}));

vi.mock('../../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn(),
}));

vi.mock('../../../src/services/safe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/services/safe')>();
  return {
    ...orig,
    createSafeExecuteTxFromCalls: vi.fn().mockResolvedValue({
      chainId: 42161,
      safeAddress: '0xacc1ffaf0000000000000000000000000000beef',
      to: '0xacc1ffaf0000000000000000000000000000beef',
      value: '0x0',
      data: '0xdeadbeef',
      operation: 0,
      safeTxGas: '0x0',
      baseGas: '0x0',
      gasPrice: '0x0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      signature: '0x',
    }),
    ensureSafeForEphemeral: vi.fn().mockResolvedValue({
      chainId: 42161,
      owner: '0xbbbb000000000000000000000000000000000002',
      address: '0xacc1ffaf0000000000000000000000000000beef',
      factoryAddress: '0x0',
      exists: true,
    }),
  };
});

vi.mock('../../../src/swap/execution/safe-dispatch', () => ({
  dispatchSafeSource: vi.fn(),
}));

// Keep the real VAULT_ABI_MAYAN + encodeMayanRouteData so the deposit calldata is real and
// decodable; stub the quote→route-data and request encoders (they need a full Mayan quote).
vi.mock('@avail-project/nexus-types/rff', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@avail-project/nexus-types/rff')>();
  return {
    ...orig,
    getRoutesDataFromQuote: vi.fn().mockResolvedValue({
      gasDrop: 0n,
      cancelFee: 0n,
      refundFee: 0n,
      random: '0x0000000000000000000000000000000000000000000000000000000000000000',
      swapProtocol: '0x0000000000000000000000000000000000000000',
      swapData: '0x',
      middleToken: '0x0000000000000000000000000000000000000000',
      minMiddleAmount: 0n,
    }),
    toMayanDepositRequest: vi.fn().mockReturnValue({
      sources: [
        {
          universe: 0,
          chainID: 42161n,
          contractAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
          value: 1000000000000000000n,
          fee: 0n,
        },
      ],
      destinationUniverse: 0,
      destinationChainID: 8453n,
      recipientAddress: '0x000000000000000000000000aaaa000000000000000000000000000000000001',
      destinations: [],
      nonce: 1n,
      expiry: 2n,
      parties: [],
    }),
  };
});

import { executeBridgeFromIntent, submitRFFToMiddleware, waitForFill } from '../../../src/bridge/executor';
import { runBridgeHooks } from '../../../src/bridge/hooks/approval';
import { prepareSwapBridgeExecution } from '../../../src/bridge/allowances/prepare-swap-sbc';
import { makeSwapExecutionMiddlewareClient } from '../../helpers/middleware-client';
import { makeTimingHooks } from '../../helpers/timing';
import { createRequestFromIntent } from '../../../src/services/rff';
import { createCaliburExecuteTxFromCalls, createSBCTxFromCalls } from '../../../src/services/sbc';
import { dispatchSafeSource } from '../../../src/swap/execution/safe-dispatch';
import { signPermitForAddressAndValue } from '../../../src/services/allowance-utils';
import { createSafeExecuteTxFromCalls } from '../../../src/services/safe';
import { predictSafeAccountAddress } from '../../../src/swap/safe/predict';
import { SWEEPER_ADDRESS } from '../../../src/swap/constants';
import { PermitVariant } from '../../../src/domain/permits';
import { executeSwapBridge } from '../../../src/swap/execution/bridge';
import { VAULT_ABI_MAYAN } from '@avail-project/nexus-types/rff';
import type { BridgeAsset, BridgeQuoteResponse, ExecutionContext, SwapMetadata, SwapRoute } from '../../../src/swap/types';

const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
const USDC_OP = '0x0b2c639c533813f4aa9d7837caf62653d097ff85' as Hex;
const ARB_CHAIN = 42161;
const BASE_CHAIN = 8453;
const OP_CHAIN = 10;

const makeBridgeQuoteResponse = (): BridgeQuoteResponse => ({
  fulfillmentBps: 100,
  sources: [
    {
      chainId: ARB_CHAIN,
      tokenAddress: USDC_ARB,
      depositFeeUsd: '0.5',
      depositFeeToken: '500000',
      depositMayanFeeUsd: '0.5',
      depositMayanFeeToken: '500000',
    },
  ],
  destination: {
    chainId: BASE_CHAIN,
    tokenAddress: USDC_BASE,
    fulfillmentFeeUsd: '1.5',
    fulfillmentFeeToken: '1500000',
  },
});

const makeBridgeAsset = (chainId = ARB_CHAIN, contractAddress = USDC_ARB): BridgeAsset => ({
  chainID: chainId,
  contractAddress,
  decimals: 6,
  eoaBalance: new Decimal(0),
  ephemeralBalance: new Decimal('3'),
});

const makeBridge = (): NonNullable<SwapRoute['bridge']> => ({
  amount: new Decimal('5'),
  amounts: {
    tokenAmount: new Decimal('3'),
    gasInCot: new Decimal('0'),
    totalAmount: new Decimal('5'),
  },
  assets: [makeBridgeAsset()],
  chainID: BASE_CHAIN,
  decimals: 6,
  tokenAddress: USDC_BASE,
  estimatedFees: {
    collection: new Decimal('0.5'),
    fulfilment: new Decimal('1.5'),
    caGas: new Decimal('2'),
    protocol: new Decimal('0.5'),
    solver: new Decimal(0),
  },
});

type BridgeCtx = Pick<
  ExecutionContext,
  | 'bridgeQuoteResponse'
  | 'cache'
  | 'chainList'
  | 'destinationDirectEoa'
  | 'eoaAddress'
  | 'eoaWallet'
  | 'ephemeralWallet'
  | 'intentExplorerUrl'
  | 'middlewareClient'
  | 'onProgress'
  | 'preparedExecution'
  | 'publicClientList'
  | 'timing'
>;

const makeCtx = (): BridgeCtx => ({
  chainList: {
    getChainByID: vi.fn().mockImplementation((chainId: number) =>
      ({
        [BASE_CHAIN]: {
          id: BASE_CHAIN,
          name: 'Base',
          rpcUrls: { default: { http: ['https://base.rpc'] } },
          nativeCurrency: { decimals: 18 },
          blockExplorers: { default: { url: 'https://basescan.org' } },
          custom: { icon: '' },
        },
        [ARB_CHAIN]: {
          id: ARB_CHAIN,
          name: 'Arbitrum',
          rpcUrls: { default: { http: ['https://arb.rpc'] } },
          nativeCurrency: { decimals: 18 },
          blockExplorers: { default: { url: 'https://arbiscan.io' } },
          custom: { icon: '' },
        },
        [OP_CHAIN]: {
          id: OP_CHAIN,
          name: 'Optimism',
          rpcUrls: { default: { http: ['https://op.rpc'] } },
          nativeCurrency: { decimals: 18 },
          blockExplorers: { default: { url: 'https://optimistic.etherscan.io' } },
          custom: { icon: '' },
        },
      })[chainId] ?? {
        id: chainId,
        name: `Chain ${chainId}`,
        rpcUrls: { default: { http: ['https://unknown.rpc'] } },
        nativeCurrency: { decimals: 18 },
        blockExplorers: { default: { url: 'https://explorer.example' } },
        custom: { icon: '' },
      }
    ),
    getVaultContractAddress: vi.fn().mockReturnValue(
      '0x9999999999999999999999999999999999999999' as Hex
    ),
    getNativeToken: vi.fn().mockReturnValue({
      contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
      decimals: 18,
      symbol: 'ETH',
      name: 'Ether',
      logo: '',
    }),
    getTokenByAddress: vi.fn().mockImplementation((_chainId: number, tokenAddress: Hex) => ({
      contractAddress: tokenAddress,
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      logo: '',
      permitVariant: 1, // PermitVariant.EIP2612Canonical — exercised by non-7702 deposit batch
      permitVersion: 2,
    })),
  } as unknown as ExecutionContext['chainList'],
  eoaAddress: '0xaaaa000000000000000000000000000000000001' as Hex,
  eoaWallet: {
    getChainId: vi.fn().mockResolvedValue(ARB_CHAIN),
    switchChain: vi.fn().mockResolvedValue(undefined),
    addChain: vi.fn().mockResolvedValue(undefined),
    writeContract: vi.fn().mockResolvedValue('0xeoa_approval' as Hex),
    sendTransaction: vi.fn().mockResolvedValue('0xnative_deposit_tx' as Hex),
  } as unknown as ExecutionContext['eoaWallet'],
  ephemeralWallet: {
    address: '0xbbbb000000000000000000000000000000000002' as Hex,
    // 65-byte signature with v=0x1b (27) so parseSignature accepts it.
    signTypedData: vi
      .fn()
      .mockResolvedValue(`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}` as Hex),
    signAuthorization: vi.fn().mockResolvedValue({ r: '0x01', s: '0x02', yParity: 0, nonce: 0 }),
  } as unknown as PrivateKeyAccount,
  publicClientList: {
    get: vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      readContract: vi
        .fn()
        .mockImplementation(async (args: { functionName: string }) => {
          if (args.functionName === 'name') return 'USD Coin';
          if (args.functionName === 'nonces') return 0n;
          return 0n;
        }),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        transactionHash: '0xbridge_tx' as Hex,
      }),
    }),
  } as unknown as ExecutionContext['publicClientList'],
  middlewareClient: makeSwapExecutionMiddlewareClient({
    submitSBCs: vi.fn().mockResolvedValue([
      {
        chainId: ARB_CHAIN,
        address: '0x0000000000000000000000000000000000000abc' as Hex,
        errored: false,
        txHash: '0xbridge_tx' as Hex,
      },
    ]),
  }),
  cache: undefined,
  intentExplorerUrl: 'https://explorer.example/rff',
  onProgress: vi.fn(),
  bridgeQuoteResponse: makeBridgeQuoteResponse(),
  preparedExecution: undefined,
  // Default: destination has a swap step (bridge recipient resolves to wrapper). Override in
  // tests that exercise the COT-direct path.
  destinationDirectEoa: false,
});

describe('executeSwapBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signPermitForAddressAndValue).mockResolvedValue(
      (`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex
    );
    vi.mocked(createSBCTxFromCalls).mockResolvedValue({
      chainId: ARB_CHAIN,
      address: '0x0000000000000000000000000000000000000001' as Hex,
      calls: [],
      deadline: '0x1' as Hex,
      keyHash: '0x0' as Hex,
      nonce: '0x1' as Hex,
      revertOnFailure: true,
      signature: '0x1234' as Hex,
    });
  });

  it('submits RFF and combined SBC deposits on the ephemeral bridge path instead of using the shared executor', async () => {
    const ctx = makeCtx();
    const timing = makeTimingHooks();
    ctx.timing = timing;
    const bridge = makeBridge();
    const executedAssets = [makeBridgeAsset()];
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, executedAssets, ctx, metadata);

    expect(createRequestFromIntent).toHaveBeenCalledTimes(1);
    expect(submitRFFToMiddleware).toHaveBeenCalledTimes(1);
    expect(createSBCTxFromCalls).toHaveBeenCalledTimes(1);
    expect(executeBridgeFromIntent).not.toHaveBeenCalled();
    expect(waitForFill).toHaveBeenCalledTimes(1);
    expect(metadata.intent_request_hash).toBe('0xabc123');
    expect(metadata.has_xcs).toBe(true);
    expect(timing.startSpan.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'flow.swap.execute.bridge.submit_intent',
        'flow.swap.execute.bridge.prepare_funding',
        'flow.swap.execute.bridge.deposit',
        'flow.swap.execute.bridge.wait_fill',
      ])
    );

    const combinedCalls = vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0].calls;
    const approveCall = decodeFunctionData({ abi: erc20Abi, data: combinedCalls[0].data });
    const depositCall = decodeFunctionData({
      abi: EVMVaultABI,
      data: combinedCalls.find((call) => call.to === ctx.chainList.getVaultContractAddress(ARB_CHAIN))!.data,
    });

    expect(approveCall.functionName).toBe('approve');
    expect(depositCall.functionName).toBe('deposit');
  });

  it('wraps missing prepared bridge funding transfers as step-scoped eoa_to_ephemeral failures', async () => {
    const ctx = {
      ...makeCtx(),
      preparedExecution: {
        parsedQuotes: [],
        eoaToEphemeralTransfers: [],
      },
    } as BridgeCtx;
    const bridge = makeBridge();
    const executedAssets = [
      {
        ...makeBridgeAsset(),
        eoaBalance: new Decimal('3'),
        ephemeralBalance: new Decimal(0),
      },
    ];
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    const result = executeSwapBridge(bridge, executedAssets, ctx, metadata);

    await expect(result).rejects.toBeInstanceOf(ExecutionError);
    await expect(result).rejects.toMatchObject({
      context: {
        stepType: 'eoa_to_ephemeral_transfer',
        stepId: createEoaToEphemeralTransferStepId(ARB_CHAIN),
      },
    });
  });

  it('logs bridge deposit failures before surfacing a later funding failure', async () => {
    const loggerError = vi.spyOn(getLogger(), 'error').mockImplementation(() => {});
    vi.mocked(createRequestFromIntent).mockResolvedValueOnce({
      depositRequest: {
        sources: [
          {
            universe: 0,
            chainID: BigInt(OP_CHAIN),
            contractAddress:
              '0x0000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85',
            value: 3000000n,
            fee: 0n,
          },
        ],
        destinations: [],
        destinationUniverse: 0,
        destinationChainID: BigInt(BASE_CHAIN),
        recipientAddress:
          '0x000000000000000000000000bbbb000000000000000000000000000000000002',
        nonce: 1n,
        expiry: 2n,
        parties: [],
      },
      rffRequest: { sources: [], destinations: [] } as never,
      signature: '0x1234',
      requestHash: '0xabc123',
    });
    vi.mocked(createSBCTxFromCalls).mockImplementationOnce(async (input) => ({
      chainId: input.chainID,
      address: '0x0000000000000000000000000000000000000001' as Hex,
      calls: [],
      deadline: '0x1' as Hex,
      keyHash: '0x0' as Hex,
      nonce: '0x1' as Hex,
      revertOnFailure: true,
      signature: '0x1234' as Hex,
    }));
    const ctx = {
      ...makeCtx(),
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockResolvedValue([
          {
            chainId: OP_CHAIN,
            address: '0x0000000000000000000000000000000000000abc' as Hex,
            errored: true,
            message: 'deposit rejected',
          },
        ]),
      }),
      preparedExecution: {
        parsedQuotes: [],
        eoaToEphemeralTransfers: [
          {
            reason: 'bridge',
            chainId: OP_CHAIN,
            tokenAddress: USDC_OP,
            amount: 3000000n,
            targetAddress: makeCtx().ephemeralWallet.address,
            authorization: null,
            transferCall: {
              to: USDC_OP,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transferFrom',
                args: [makeCtx().eoaAddress, makeCtx().ephemeralWallet.address, 3000000n],
              }),
              value: 0n,
            },
          },
        ],
      },
    } as BridgeCtx;
    const bridge = makeBridge();
    const executedAssets = [
      {
        ...makeBridgeAsset(ARB_CHAIN, USDC_ARB),
        eoaBalance: new Decimal('3'),
        ephemeralBalance: new Decimal(0),
      },
      {
        ...makeBridgeAsset(OP_CHAIN, USDC_OP),
        eoaBalance: new Decimal('3'),
        ephemeralBalance: new Decimal(0),
      },
    ];
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    try {
      const result = executeSwapBridge(bridge, executedAssets, ctx, metadata);

      await expect(result).rejects.toMatchObject({
        context: {
          stepType: 'eoa_to_ephemeral_transfer',
          stepId: createEoaToEphemeralTransferStepId(ARB_CHAIN),
        },
      });
      expect(loggerError).toHaveBeenCalledWith(
        'executeSwapBridge:bridge_deposit:failed_before_funding_error',
        expect.any(Error),
        expect.objectContaining({
          chainId: OP_CHAIN,
          fundingError: expect.stringContaining(
            `Missing bridge funding transfer for chain ${ARB_CHAIN}`
          ),
        })
      );
    } finally {
      loggerError.mockRestore();
    }
  });

  it('includes permit and transferFrom before the combined deposit when permit funding is available', async () => {
    const ctx = {
      ...makeCtx(),
      preparedExecution: {
        parsedQuotes: [],
        eoaToEphemeralTransfers: [
          {
            reason: 'bridge',
            chainId: ARB_CHAIN,
            tokenAddress: USDC_ARB,
            amount: 3000000n,
            targetAddress: makeCtx().ephemeralWallet.address,
            authorization: {
              kind: 'permit',
              call: null,
              permit: {
                signature: null,
                permitVariant: 1,
                permitContractVersion: 2,
              },
            },
            transferCall: {
              to: USDC_ARB,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transferFrom',
                args: [makeCtx().eoaAddress, makeCtx().ephemeralWallet.address, 3000000n],
              }),
              value: 0n,
            },
          },
        ],
      },
    } as BridgeCtx;
    const bridge = makeBridge();
    const executedAssets = [
      {
        ...makeBridgeAsset(),
        eoaBalance: new Decimal('3'),
        ephemeralBalance: new Decimal(0),
      },
    ];
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, executedAssets, ctx, metadata);

    const combinedCalls = vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0].calls;
    const permitCall = decodeFunctionData({
      abi: ERC20PermitABI,
      data: combinedCalls[0].data,
    });
    const transferCall = decodeFunctionData({
      abi: erc20Abi,
      data: combinedCalls[1].data,
    });

    expect(permitCall.functionName).toBe('permit');
    expect(transferCall.functionName).toBe('transferFrom');
    expect(ctx.eoaWallet.writeContract).not.toHaveBeenCalled();
  });

  it('executes a paid EOA approval before the combined deposit when permit support is unavailable', async () => {
    const approvalData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [makeCtx().ephemeralWallet.address, 3000000n],
    });
    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transferFrom',
      args: [makeCtx().eoaAddress, makeCtx().ephemeralWallet.address, 3000000n],
    });
    const ctx = {
      ...makeCtx(),
      preparedExecution: {
        parsedQuotes: [],
        eoaToEphemeralTransfers: [
          {
            reason: 'bridge',
            chainId: ARB_CHAIN,
            tokenAddress: USDC_ARB,
            amount: 3000000n,
            targetAddress: makeCtx().ephemeralWallet.address,
            authorization: {
              kind: 'approve',
              call: {
                to: USDC_ARB,
                data: approvalData,
                value: 0n,
              },
              permit: null,
            },
            transferCall: {
              to: USDC_ARB,
              data: transferData,
              value: 0n,
            },
          },
        ],
      },
    } as BridgeCtx;
    const bridge = makeBridge();
    const executedAssets = [
      {
        ...makeBridgeAsset(),
        eoaBalance: new Decimal('3'),
        ephemeralBalance: new Decimal(0),
      },
    ];
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, executedAssets, ctx, metadata);

    expect(ctx.eoaWallet.writeContract).toHaveBeenCalledTimes(1);
    const combinedCalls = vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0].calls;
    expect(combinedCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: USDC_ARB,
          data: transferData,
        }),
      ])
    );
    expect(combinedCalls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: USDC_ARB,
          data: approvalData,
        }),
      ])
    );
  });

  it('treats the user EOA wallet as a single-chain resource while submitting one bridge deposit SBC per chain', async () => {
    vi.mocked(createRequestFromIntent).mockResolvedValueOnce({
      depositRequest: {
        sources: [
          {
            universe: 0,
            chainID: BigInt(ARB_CHAIN),
            contractAddress:
              '0x000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831',
            value: 3000000n,
            fee: 0n,
          },
          {
            universe: 0,
            chainID: BigInt(OP_CHAIN),
            contractAddress:
              '0x0000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85',
            value: 3000000n,
            fee: 0n,
          },
        ],
        destinations: [],
        destinationUniverse: 0,
        destinationChainID: BigInt(BASE_CHAIN),
        recipientAddress:
          '0x000000000000000000000000bbbb000000000000000000000000000000000002',
        nonce: 1n,
        expiry: 2n,
        parties: [],
      },
      rffRequest: {
        sources: [],
        destination_universe: 'EVM',
        destination_chain_id: `0x${BASE_CHAIN.toString(16).padStart(64, '0')}`,
        recipient_address:
          '0x000000000000000000000000bbbb000000000000000000000000000000000002',
        destinations: [],
        nonce: '1',
        expiry: '2',
        parties: [],
      },
      signature: '0x1234',
      requestHash: '0xabc123',
    });
    vi.mocked(createSBCTxFromCalls).mockImplementation(async (input) => ({
      chainId: input.chainID,
      address: '0x0000000000000000000000000000000000000001' as Hex,
      calls: [],
      deadline: '0x1' as Hex,
      keyHash: '0x0' as Hex,
      nonce: '0x1' as Hex,
      revertOnFailure: true,
      signature: '0x1234' as Hex,
    }));

    let currentChainId = ARB_CHAIN;
    let activeEoaOperations = 0;
    let maxConcurrentEoaOperations = 0;
    const operationOrder: string[] = [];
    const runEoaOperation = async (label: string, complete?: () => void) => {
      operationOrder.push(`${label}:start`);
      activeEoaOperations += 1;
      maxConcurrentEoaOperations = Math.max(maxConcurrentEoaOperations, activeEoaOperations);
      await new Promise((resolve) => setTimeout(resolve, 10));
      complete?.();
      activeEoaOperations -= 1;
      operationOrder.push(`${label}:end`);
    };

    const ctx = {
      ...makeCtx(),
      eoaWallet: {
        getChainId: vi.fn().mockImplementation(async () => currentChainId),
        switchChain: vi.fn().mockImplementation(async ({ id }: { id: number }) => {
          await runEoaOperation(`switch:${id}`, () => {
            currentChainId = id;
          });
        }),
        addChain: vi.fn().mockResolvedValue(undefined),
        writeContract: vi.fn().mockImplementation(async () => {
          await runEoaOperation(`approve:${ARB_CHAIN}`);
          return '0xeoa_approval' as Hex;
        }),
      } as unknown as ExecutionContext['eoaWallet'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockImplementation(async (sbcTxs: Array<{ chainId: number; address: Hex }>) =>
          sbcTxs.map((tx) => {
            operationOrder.push(`submit:${tx.chainId}:start`);
            return {
              chainId: tx.chainId,
              address: tx.address,
              errored: false,
              txHash: `0x${tx.chainId.toString(16).padStart(64, '0')}` as Hex,
            };
          })
        ),
      }),
      preparedExecution: {
        parsedQuotes: [],
        eoaToEphemeralTransfers: [
          {
            reason: 'bridge',
            chainId: ARB_CHAIN,
            tokenAddress: USDC_ARB,
            amount: 3000000n,
            targetAddress: makeCtx().ephemeralWallet.address,
            authorization: {
              kind: 'approve',
              call: {
                to: USDC_ARB,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: 'approve',
                  args: [makeCtx().ephemeralWallet.address, 3000000n],
                }),
                value: 0n,
              },
              permit: null,
            },
            transferCall: {
              to: USDC_ARB,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transferFrom',
                args: [makeCtx().eoaAddress, makeCtx().ephemeralWallet.address, 3000000n],
              }),
              value: 0n,
            },
          },
          {
            reason: 'bridge',
            chainId: OP_CHAIN,
            tokenAddress: USDC_OP,
            amount: 3000000n,
            targetAddress: makeCtx().ephemeralWallet.address,
            authorization: {
              kind: 'permit',
              call: null,
              permit: {
                signature: null,
                permitVariant: 1,
                permitContractVersion: 2,
              },
            },
            transferCall: {
              to: USDC_OP,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transferFrom',
                args: [makeCtx().eoaAddress, makeCtx().ephemeralWallet.address, 3000000n],
              }),
              value: 0n,
            },
          },
        ],
      },
    } as BridgeCtx;
    vi.mocked(signPermitForAddressAndValue).mockImplementation(async () => {
      await runEoaOperation(`permit:${OP_CHAIN}`);
      return (`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex;
    });

    const bridge = makeBridge();
    const executedAssets = [
      {
        ...makeBridgeAsset(ARB_CHAIN, USDC_ARB),
        eoaBalance: new Decimal('3'),
        ephemeralBalance: new Decimal(0),
      },
      {
        ...makeBridgeAsset(OP_CHAIN, USDC_OP),
        eoaBalance: new Decimal('3'),
        ephemeralBalance: new Decimal(0),
      },
    ];
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, executedAssets, ctx, metadata);

    const eoaWalletChainOperationLimit = 1;
    expect(maxConcurrentEoaOperations).toBe(eoaWalletChainOperationLimit);
    expect(ctx.middlewareClient.submitSBCs).toHaveBeenCalledTimes(2);
    const submittedBatches = vi
      .mocked(ctx.middlewareClient.submitSBCs)
      .mock.calls.map(([txs]) => txs.map((tx) => tx.chainId));
    expect(submittedBatches).toEqual([[OP_CHAIN], [ARB_CHAIN]]);
    expect(operationOrder.indexOf(`submit:${OP_CHAIN}:start`)).toBeGreaterThan(
      operationOrder.indexOf(`permit:${OP_CHAIN}:end`)
    );
    expect(operationOrder.indexOf(`submit:${OP_CHAIN}:start`)).toBeLessThan(
      operationOrder.indexOf(`approve:${ARB_CHAIN}:end`)
    );

    const progress = vi.mocked(ctx.onProgress!).mock.calls.map(([event]) => ({
      stepType: event.stepType,
      chainId: 'chainId' in event ? event.chainId : undefined,
      state: event.state,
    }));
    expect(progress).toEqual(
      expect.arrayContaining([
        { stepType: 'eoa_to_ephemeral_transfer', chainId: ARB_CHAIN, state: 'wallet_prompted' },
        { stepType: 'eoa_to_ephemeral_transfer', chainId: OP_CHAIN, state: 'wallet_prompted' },
        { stepType: 'eoa_to_ephemeral_transfer', chainId: ARB_CHAIN, state: 'submitted' },
        { stepType: 'eoa_to_ephemeral_transfer', chainId: OP_CHAIN, state: 'submitted' },
        { stepType: 'eoa_to_ephemeral_transfer', chainId: ARB_CHAIN, state: 'confirmed' },
        { stepType: 'eoa_to_ephemeral_transfer', chainId: OP_CHAIN, state: 'confirmed' },
      ])
    );
    expect(
      progress.findIndex(
        (event) => event.stepType === 'bridge_intent_submission' && event.state === 'completed'
      )
    ).toBeLessThan(
      progress.findIndex(
        (event) =>
          event.stepType === 'eoa_to_ephemeral_transfer' &&
          event.chainId === ARB_CHAIN &&
          event.state === 'wallet_prompted'
      )
    );
  });

  it('routes the bridge deposit batch via Safe (not SBC) on non-7702 source chains', async () => {
    const baseCtx = makeCtx();
    const createSafeExecuteTx = vi.fn().mockResolvedValue({
      txHash: '0xsafe_deposit_tx' as Hex,
    });
    const submitSBCs = vi.fn().mockResolvedValue([]);
    const ctx = {
      ...baseCtx,
      chainList: {
        ...baseCtx.chainList,
        getChainByID: vi.fn().mockImplementation((chainId: number) => {
          const chain = baseCtx.chainList.getChainByID(chainId) as Record<string, unknown>;
          if (chainId === ARB_CHAIN) {
            return { ...chain, supports7702: false };
          }
          return chain;
        }),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs,
        createSafeExecuteTx,
        getSafeAccountAddress: vi.fn().mockResolvedValue({
          address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
        }),
        ensureSafeAccount: vi.fn().mockResolvedValue({}),
      }),
    } as BridgeCtx;
    const bridge = makeBridge();
    const executedAssets = [makeBridgeAsset()];
    const metadata: SwapMetadata = {
      src: [],
      dst: null,
      has_xcs: false,
      intent_request_hash: null,
    };

    await executeSwapBridge(bridge, executedAssets, ctx, metadata);

    expect(createSafeExecuteTx).toHaveBeenCalled();
    expect(submitSBCs).not.toHaveBeenCalled();
  });

  it('sets bridge intent recipient to the predicted Safe address when destination is non-7702 and has a dst swap step', async () => {
    // v1 parallel: bridgeInput.recipientAddress = destinationExecution.address when destination
    // is a Safe wrapper. The bridge fill lands at the Safe so Safe.execTransaction can run the
    // dst aggregator swap and deliver output to the EOA.
    const baseCtx = makeCtx();
    const ctx = {
      ...baseCtx,
      // `destinationDirectEoa: false` (default in makeCtx) + non-7702 dst chain → bridge
      // recipient resolves to the predicted Safe.
      destinationDirectEoa: false,
      chainList: {
        ...baseCtx.chainList,
        getChainByID: vi.fn().mockImplementation((chainId: number) => {
          const chain = baseCtx.chainList.getChainByID(chainId) as Record<string, unknown>;
          if (chainId === BASE_CHAIN) return { ...chain, supports7702: false };
          return chain;
        }),
      } as unknown as ExecutionContext['chainList'],
    } as BridgeCtx;
    const bridge = makeBridge();
    const executedAssets = [makeBridgeAsset()];
    const metadata: SwapMetadata = {
      src: [],
      dst: null,
      has_xcs: false,
      intent_request_hash: null,
    };

    await executeSwapBridge(bridge, executedAssets, ctx, metadata);

    const intent = vi.mocked(createRequestFromIntent).mock.calls[0]?.[0];
    const safeAddress = '0x2d7E4C3ef02B86D271624742C6e81636f4c9e663'; // predictSafeAccountAddress(0xbbbb...0002)
    expect(intent?.recipientAddress.toLowerCase()).toBe(safeAddress.toLowerCase());
  });

  it('builds the 3-step deposit batch (no Sweeper) on non-7702 source chains', async () => {
    // Seam 1 bridges the actual wrapper balance, so transfer(ephemeral, depositValue) moves the
    // FULL Safe COT and the deposit drains it — nothing residual stays at the Safe. The old v1
    // steps 4-5 (approve(Sweeper) + Sweeper.sweepERC20) are gone; the batch is just:
    //   1. transfer(ephemeral, depositValue) — Safe sends the deposit amount to ephemeral
    //   2. permit(ephemeral → vault) — ephemeral grants vault allowance via EIP-2612
    //   3. vault.deposit(...) — vault.transferFrom(ephemeral, vault, depositValue)
    const baseCtx = makeCtx();
    const createSafeExecuteTx = vi.fn().mockResolvedValue({
      txHash: '0xsafe_deposit_tx' as Hex,
    });
    const safeReadContract = vi.fn().mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'name') return Promise.resolve('USD Coin');
      if (args.functionName === 'nonces') return Promise.resolve(7n);
      return Promise.resolve(0n);
    });
    const tokenByAddress = vi.fn().mockImplementation((_chainId: number, tokenAddress: Hex) => ({
      contractAddress: tokenAddress,
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      logo: '',
      permitVariant: PermitVariant.EIP2612Canonical,
      permitVersion: 2,
    }));
    const ctx = {
      ...baseCtx,
      chainList: {
        ...baseCtx.chainList,
        getChainByID: vi.fn().mockImplementation((chainId: number) => {
          const chain = baseCtx.chainList.getChainByID(chainId) as Record<string, unknown>;
          if (chainId === ARB_CHAIN) {
            return { ...chain, supports7702: false };
          }
          return chain;
        }),
        getTokenByAddress: tokenByAddress,
      } as unknown as ExecutionContext['chainList'],
      publicClientList: {
        get: vi.fn().mockReturnValue({
          getCode: vi.fn().mockResolvedValue(undefined),
          readContract: safeReadContract,
          waitForTransactionReceipt: vi.fn().mockResolvedValue({
            status: 'success',
            transactionHash: '0xsafe_deposit_tx' as Hex,
          }),
        }),
      } as unknown as ExecutionContext['publicClientList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockResolvedValue([]),
        createSafeExecuteTx,
        getSafeAccountAddress: vi.fn().mockResolvedValue({
          address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
        }),
        ensureSafeAccount: vi.fn().mockResolvedValue({}),
      }),
    } as BridgeCtx;
    const bridge = makeBridge();
    const executedAssets = [makeBridgeAsset()];
    const metadata: SwapMetadata = {
      src: [],
      dst: null,
      has_xcs: false,
      intent_request_hash: null,
    };

    await executeSwapBridge(bridge, executedAssets, ctx, metadata);

    expect(createSafeExecuteTxFromCalls).toHaveBeenCalledTimes(1);
    const callsArg = vi.mocked(createSafeExecuteTxFromCalls).mock.calls[0]?.[0]?.calls ?? [];

    // depositValue = mocked depositRequest.sources[0].value (3000000n)
    const depositValue = 3000000n;
    const vaultAddress = (ctx.chainList.getVaultContractAddress(ARB_CHAIN)) as Hex;
    const ephemeral = ctx.ephemeralWallet.address;

    // Step 1: Safe → ephemeral transfer
    const transferCall = decodeFunctionData({ abi: erc20Abi, data: callsArg[0].data });
    expect(transferCall.functionName).toBe('transfer');
    expect((transferCall.args?.[0] as string).toLowerCase()).toBe(ephemeral.toLowerCase());
    expect(transferCall.args?.[1]).toBe(depositValue);
    expect(callsArg[0].to.toLowerCase()).toBe(USDC_ARB.toLowerCase());

    // Step 2: permit(ephemeral, vault, depositValue, ...)
    const permitCall = decodeFunctionData({ abi: ERC20PermitABI, data: callsArg[1].data });
    expect(permitCall.functionName).toBe('permit');
    expect((permitCall.args?.[0] as string).toLowerCase()).toBe(ephemeral.toLowerCase());
    expect((permitCall.args?.[1] as string).toLowerCase()).toBe(vaultAddress.toLowerCase());
    expect(permitCall.args?.[2]).toBe(depositValue);

    // Step 3: vault.deposit
    const depositCall = decodeFunctionData({ abi: EVMVaultABI, data: callsArg[2].data });
    expect(depositCall.functionName).toBe('deposit');

    // No Sweeper steps — the deposit drained the Safe, so there's nothing to sweep.
    expect(callsArg).toHaveLength(3);
    for (const call of callsArg) {
      expect(call.to.toLowerCase()).not.toBe((SWEEPER_ADDRESS as string).toLowerCase());
    }
  });

  it('funds the Safe (permit + transferFrom EOA->Safe) before the deposit on a non-7702 fast-path bridge', async () => {
    // Fast-path bridge: no source swap funded the Safe, so the bridged COT sits at the EOA
    // (eoaBalance > 0). The non-7702 deposit batch must consume the prepared EOA->Safe funding
    // (permit + transferFrom) before transfer(Safe->ephemeral), else the Safe is empty -> GS013.
    const baseCtx = makeCtx();
    const safeAddress = predictSafeAccountAddress(baseCtx.ephemeralWallet.address).address;
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xsafe_deposit_tx' as Hex });
    const safeReadContract = vi.fn().mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'name') return Promise.resolve('USD Coin');
      if (args.functionName === 'nonces') return Promise.resolve(7n);
      return Promise.resolve(0n);
    });
    const tokenByAddress = vi.fn().mockImplementation((_chainId: number, tokenAddress: Hex) => ({
      contractAddress: tokenAddress,
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      logo: '',
      permitVariant: PermitVariant.EIP2612Canonical,
      permitVersion: 2,
    }));
    const ctx = {
      ...baseCtx,
      preparedExecution: {
        parsedQuotes: [],
        eoaToEphemeralTransfers: [
          {
            reason: 'bridge',
            chainId: ARB_CHAIN,
            tokenAddress: USDC_ARB,
            amount: 3000000n,
            targetAddress: safeAddress,
            authorization: {
              kind: 'permit',
              call: null,
              permit: { signature: null, permitVariant: 1, permitContractVersion: 2 },
            },
            transferCall: {
              to: USDC_ARB,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transferFrom',
                args: [baseCtx.eoaAddress, safeAddress, 3000000n],
              }),
              value: 0n,
            },
          },
        ],
      },
      chainList: {
        ...baseCtx.chainList,
        getChainByID: vi.fn().mockImplementation((chainId: number) => {
          const chain = baseCtx.chainList.getChainByID(chainId) as Record<string, unknown>;
          if (chainId === ARB_CHAIN) {
            return { ...chain, supports7702: false };
          }
          return chain;
        }),
        getTokenByAddress: tokenByAddress,
      } as unknown as ExecutionContext['chainList'],
      publicClientList: {
        get: vi.fn().mockReturnValue({
          getCode: vi.fn().mockResolvedValue(undefined),
          readContract: safeReadContract,
          waitForTransactionReceipt: vi.fn().mockResolvedValue({
            status: 'success',
            transactionHash: '0xsafe_deposit_tx' as Hex,
          }),
        }),
      } as unknown as ExecutionContext['publicClientList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockResolvedValue([]),
        createSafeExecuteTx,
        getSafeAccountAddress: vi.fn().mockResolvedValue({
          address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
        }),
        ensureSafeAccount: vi.fn().mockResolvedValue({}),
      }),
    } as BridgeCtx;
    const bridge = makeBridge();
    const executedAssets = [
      {
        ...makeBridgeAsset(),
        eoaBalance: new Decimal('3'),
        ephemeralBalance: new Decimal(0),
      },
    ];
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, executedAssets, ctx, metadata);

    expect(createSafeExecuteTxFromCalls).toHaveBeenCalledTimes(1);
    const callsArg = vi.mocked(createSafeExecuteTxFromCalls).mock.calls[0]?.[0]?.calls ?? [];

    // Funding runs first: permit(EOA -> Safe) then transferFrom(EOA -> Safe) …
    const permitCall = decodeFunctionData({ abi: ERC20PermitABI, data: callsArg[0].data });
    expect(permitCall.functionName).toBe('permit');
    expect((permitCall.args?.[1] as string).toLowerCase()).toBe(safeAddress.toLowerCase());
    const fundingTransfer = decodeFunctionData({ abi: erc20Abi, data: callsArg[1].data });
    expect(fundingTransfer.functionName).toBe('transferFrom');
    expect((fundingTransfer.args?.[1] as string).toLowerCase()).toBe(safeAddress.toLowerCase());

    // … then the deposit batch's Safe -> ephemeral transfer.
    const transferCall = decodeFunctionData({ abi: erc20Abi, data: callsArg[2].data });
    expect(transferCall.functionName).toBe('transfer');
    expect((transferCall.args?.[0] as string).toLowerCase()).toBe(
      baseCtx.ephemeralWallet.address.toLowerCase()
    );
  });

  it('moves COT Safe→ephemeral + permits the vault for a non-7702 Mayan source (no deposit, no SBC approve)', async () => {
    // On a non-7702 source chain the source-swap COT sits on the Safe, but the Mayan deposit pulls
    // from the ephemeral. So the "approval" must be a Safe.execTransaction batch of
    // transfer(Safe→ephemeral) + permit(ephemeral→vault) — NOT a Calibur SBC approve — and the
    // depositMayan itself stays sponsored by the middleware (no deposit call in this batch).
    const baseCtx = makeCtx();
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xsafe_mayan_approve' as Hex });
    const safeReadContract = vi.fn().mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'name') return Promise.resolve('USD Coin');
      if (args.functionName === 'nonces') return Promise.resolve(7n);
      return Promise.resolve(0n);
    });
    const tokenByAddress = vi.fn().mockImplementation((_chainId: number, tokenAddress: Hex) => ({
      contractAddress: tokenAddress,
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      logo: '',
      permitVariant: PermitVariant.EIP2612Canonical,
      permitVersion: 2,
    }));
    const ctx = {
      ...baseCtx,
      chainList: {
        ...baseCtx.chainList,
        getChainByID: vi.fn().mockImplementation((chainId: number) => {
          const chain = baseCtx.chainList.getChainByID(chainId) as Record<string, unknown>;
          if (chainId === ARB_CHAIN) return { ...chain, supports7702: false };
          return chain;
        }),
        getTokenByAddress: tokenByAddress,
      } as unknown as ExecutionContext['chainList'],
      publicClientList: {
        get: vi.fn().mockReturnValue({
          getCode: vi.fn().mockResolvedValue(undefined),
          readContract: safeReadContract,
          waitForTransactionReceipt: vi.fn().mockResolvedValue({
            status: 'success',
            transactionHash: '0xsafe_mayan_approve' as Hex,
          }),
        }),
      } as unknown as ExecutionContext['publicClientList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        // Succeeds so the current (wrong) SBC-approve path completes and the test fails on the
        // assertion below, not on a mid-flight SBC error.
        submitSBCs: vi
          .fn()
          .mockResolvedValue([{ chainId: ARB_CHAIN, errored: false, txHash: '0xsbc_approve' as Hex }]),
        createSafeExecuteTx,
        getSafeAccountAddress: vi.fn().mockResolvedValue({
          address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
        }),
        ensureSafeAccount: vi.fn().mockResolvedValue({}),
      }),
    } as BridgeCtx;

    const bridge: NonNullable<SwapRoute['bridge']> = {
      ...makeBridge(),
      provider: 'mayan',
      mayanQuotesBySource: new Map([
        [
          `${ARB_CHAIN}:${USDC_ARB.toLowerCase()}`,
          { minReceived: 3, deadline64: '2', protocolBps: 3 } as never,
        ],
      ]),
    };
    const asset: BridgeAsset = {
      chainID: ARB_CHAIN,
      contractAddress: USDC_ARB,
      decimals: 6,
      eoaBalance: new Decimal(0),
      ephemeralBalance: new Decimal('3'), // source-swap COT, on the Safe
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, [asset], ctx, metadata);

    // Approval is a Safe batch, not a Calibur SBC.
    expect(createSBCTxFromCalls).not.toHaveBeenCalled();
    expect(createSafeExecuteTxFromCalls).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(createSafeExecuteTxFromCalls).mock.calls[0]?.[0]?.calls ?? [];
    const depositValue = 3000000n; // totalBalance = 3 USDC
    const ephemeral = ctx.ephemeralWallet.address;
    const vaultAddress = ctx.chainList.getVaultContractAddress(ARB_CHAIN) as Hex;

    // Step 1: Safe → ephemeral transfer of the COT.
    const transferCall = decodeFunctionData({ abi: erc20Abi, data: calls[0].data });
    expect(transferCall.functionName).toBe('transfer');
    expect((transferCall.args?.[0] as string).toLowerCase()).toBe(ephemeral.toLowerCase());
    expect(transferCall.args?.[1]).toBe(depositValue);

    // Step 2: permit(ephemeral → vault) granting the deposit allowance.
    const permitCall = decodeFunctionData({ abi: ERC20PermitABI, data: calls[1].data });
    expect(permitCall.functionName).toBe('permit');
    expect((permitCall.args?.[0] as string).toLowerCase()).toBe(ephemeral.toLowerCase());
    expect((permitCall.args?.[1] as string).toLowerCase()).toBe(vaultAddress.toLowerCase());
    expect(permitCall.args?.[2]).toBe(depositValue);

    // No vault.deposit in the approve batch — Mayan's depositMayan is sponsored separately.
    const hasDeposit = calls.some((c) => {
      try {
        return decodeFunctionData({ abi: EVMVaultABI, data: c.data }).functionName === 'deposit';
      } catch {
        return false;
      }
    });
    expect(hasDeposit).toBe(false);

    expect(submitRFFToMiddleware).toHaveBeenCalled();
    expect(waitForFill).toHaveBeenCalledTimes(1);
  });

  it('funds the Safe (permit + transferFrom EOA->Safe) before Safe->ephemeral on a non-7702 Mayan fast-path source', async () => {
    // Mayan fast path: no source swap, so the COT is at the EOA (eoaBalance > 0), not the Safe.
    // The Safe approve batch (transfer(Safe->ephemeral) + permit(ephemeral->vault)) must be preceded
    // by the prepared EOA->Safe funding — the sponsored depositMayan then pulls from the ephemeral.
    const baseCtx = makeCtx();
    const safeAddress = predictSafeAccountAddress(baseCtx.ephemeralWallet.address).address;
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xsafe_mayan_approve' as Hex });
    const safeReadContract = vi.fn().mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'name') return Promise.resolve('USD Coin');
      if (args.functionName === 'nonces') return Promise.resolve(7n);
      return Promise.resolve(0n);
    });
    const tokenByAddress = vi.fn().mockImplementation((_chainId: number, tokenAddress: Hex) => ({
      contractAddress: tokenAddress,
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      logo: '',
      permitVariant: PermitVariant.EIP2612Canonical,
      permitVersion: 2,
    }));
    const ctx = {
      ...baseCtx,
      preparedExecution: {
        parsedQuotes: [],
        eoaToEphemeralTransfers: [
          {
            reason: 'bridge',
            chainId: ARB_CHAIN,
            tokenAddress: USDC_ARB,
            amount: 3000000n,
            targetAddress: safeAddress,
            authorization: {
              kind: 'permit',
              call: null,
              permit: { signature: null, permitVariant: 1, permitContractVersion: 2 },
            },
            transferCall: {
              to: USDC_ARB,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transferFrom',
                args: [baseCtx.eoaAddress, safeAddress, 3000000n],
              }),
              value: 0n,
            },
          },
        ],
      },
      chainList: {
        ...baseCtx.chainList,
        getChainByID: vi.fn().mockImplementation((chainId: number) => {
          const chain = baseCtx.chainList.getChainByID(chainId) as Record<string, unknown>;
          if (chainId === ARB_CHAIN) return { ...chain, supports7702: false };
          return chain;
        }),
        getTokenByAddress: tokenByAddress,
      } as unknown as ExecutionContext['chainList'],
      publicClientList: {
        get: vi.fn().mockReturnValue({
          getCode: vi.fn().mockResolvedValue(undefined),
          readContract: safeReadContract,
          waitForTransactionReceipt: vi.fn().mockResolvedValue({
            status: 'success',
            transactionHash: '0xsafe_mayan_approve' as Hex,
          }),
        }),
      } as unknown as ExecutionContext['publicClientList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockResolvedValue([]),
        createSafeExecuteTx,
        getSafeAccountAddress: vi.fn().mockResolvedValue({
          address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
        }),
        ensureSafeAccount: vi.fn().mockResolvedValue({}),
      }),
    } as BridgeCtx;

    const bridge: NonNullable<SwapRoute['bridge']> = {
      ...makeBridge(),
      provider: 'mayan',
      mayanQuotesBySource: new Map([
        [
          `${ARB_CHAIN}:${USDC_ARB.toLowerCase()}`,
          { minReceived: 3, deadline64: '2', protocolBps: 3 } as never,
        ],
      ]),
    };
    const asset: BridgeAsset = {
      chainID: ARB_CHAIN,
      contractAddress: USDC_ARB,
      decimals: 6,
      eoaBalance: new Decimal('3'), // fast path: COT still at the EOA
      ephemeralBalance: new Decimal(0),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, [asset], ctx, metadata);

    expect(createSafeExecuteTxFromCalls).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(createSafeExecuteTxFromCalls).mock.calls[0]?.[0]?.calls ?? [];

    // Funding first: permit(EOA -> Safe), transferFrom(EOA -> Safe) …
    const permitCall = decodeFunctionData({ abi: ERC20PermitABI, data: calls[0].data });
    expect(permitCall.functionName).toBe('permit');
    expect((permitCall.args?.[1] as string).toLowerCase()).toBe(safeAddress.toLowerCase());
    const fundingTransfer = decodeFunctionData({ abi: erc20Abi, data: calls[1].data });
    expect(fundingTransfer.functionName).toBe('transferFrom');
    expect((fundingTransfer.args?.[1] as string).toLowerCase()).toBe(safeAddress.toLowerCase());

    // … then the Mayan approve batch's Safe -> ephemeral transfer.
    const transferCall = decodeFunctionData({ abi: erc20Abi, data: calls[2].data });
    expect(transferCall.functionName).toBe('transfer');
    expect((transferCall.args?.[0] as string).toLowerCase()).toBe(
      baseCtx.ephemeralWallet.address.toLowerCase()
    );
  });

  it('deposits a native source via EOA-submitted Calibur execute carrying value, skipping approve and funding (7702)', async () => {
    // Phase 1b: a same-family native bridge holds the native at the EOA. The relay can't pay
    // `value`, so the deposit is an EOA-submitted payable Calibur execute{value} — no funding
    // transfer, no approve. depositValue comes from depositRequest.sources[i].value (= native wei).
    const NATIVE = '0x0000000000000000000000000000000000000000' as Hex;
    const depositValue = 1_000_000_000_000_000_000n; // 1 ETH
    vi.mocked(createRequestFromIntent).mockResolvedValueOnce({
      depositRequest: {
        sources: [
          {
            universe: 0,
            chainID: BigInt(ARB_CHAIN),
            contractAddress:
              '0x0000000000000000000000000000000000000000000000000000000000000000',
            value: depositValue,
            fee: 0n,
          },
        ],
        destinations: [],
        destinationUniverse: 0,
        destinationChainID: BigInt(BASE_CHAIN),
        recipientAddress:
          '0x000000000000000000000000aaaa000000000000000000000000000000000001',
        nonce: 1n,
        expiry: 2n,
        parties: [],
      },
      rffRequest: { sources: [], destinations: [] } as never,
      signature: '0x1234',
      requestHash: '0xabc123',
    });
    vi.mocked(createCaliburExecuteTxFromCalls).mockResolvedValue({
      to: '0xbbbb000000000000000000000000000000000002' as Hex,
      data: '0xexecute' as Hex,
      value: depositValue,
    });
    const hasAuthCodeSet = vi.fn().mockReturnValue(false);
    const markAuthCodeSet = vi.fn();
    const ctx = {
      ...makeCtx(),
      cache: { hasAuthCodeSet, markAuthCodeSet } as unknown as ExecutionContext['cache'],
      destinationDirectEoa: true,
    } as BridgeCtx;
    let currentChainId = 1;
    vi.mocked(ctx.eoaWallet.getChainId).mockImplementation(async () => currentChainId);
    vi.mocked(ctx.eoaWallet.switchChain).mockImplementation(async ({ id }: { id: number }) => {
      currentChainId = id;
    });
    const bridge: NonNullable<SwapRoute['bridge']> = {
      ...makeBridge(),
      tokenAddress: NATIVE,
      decimals: 18,
      amounts: { tokenAmount: new Decimal('1'), gasInCot: new Decimal(0), totalAmount: new Decimal('1') },
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    };
    const nativeAsset: BridgeAsset = {
      chainID: ARB_CHAIN,
      contractAddress: NATIVE,
      decimals: 18,
      eoaBalance: new Decimal('1'),
      ephemeralBalance: new Decimal(0),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, [nativeAsset], ctx, metadata);

    // Calibur delegation bootstrap (empty-calls SBC) runs because the ephemeral isn't delegated.
    expect(hasAuthCodeSet).toHaveBeenCalledWith(ctx.ephemeralWallet.address, ARB_CHAIN);
    expect(vi.mocked(createSBCTxFromCalls).mock.calls.at(-1)?.[0]?.calls).toEqual([]);
    expect(markAuthCodeSet).toHaveBeenCalledWith(ctx.ephemeralWallet.address, ARB_CHAIN);

    // The deposit is wrapped in a payable Calibur execute carrying the native value...
    expect(createCaliburExecuteTxFromCalls).toHaveBeenCalledTimes(1);
    const caliburInput = vi.mocked(createCaliburExecuteTxFromCalls).mock.calls[0]?.[0];
    expect(caliburInput?.value).toBe(depositValue);
    expect(caliburInput?.calls).toHaveLength(1);
    const depositCall = caliburInput!.calls[0];
    expect(depositCall.value).toBe(depositValue);
    expect((depositCall.to as string).toLowerCase()).toBe(
      (ctx.chainList.getVaultContractAddress(ARB_CHAIN) as string).toLowerCase()
    );
    expect(decodeFunctionData({ abi: EVMVaultABI, data: depositCall.data }).functionName).toBe('deposit');
    // ...with no ERC-20 approve in the batch.
    const hasApprove = caliburInput!.calls.some((call) => {
      try {
        return decodeFunctionData({ abi: erc20Abi, data: call.data }).functionName === 'approve';
      } catch {
        return false;
      }
    });
    expect(hasApprove).toBe(false);

    // The EOA submits the payable execute (the relay can't carry value).
    expect(ctx.eoaWallet.switchChain).toHaveBeenCalledWith({ id: ARB_CHAIN });
    expect(ctx.eoaWallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ctx.eoaWallet.sendTransaction).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        account: ctx.eoaAddress,
        to: '0xbbbb000000000000000000000000000000000002',
        value: depositValue,
      })
    );
    expect(waitForFill).toHaveBeenCalledTimes(1);
  });

  it('deposits a native Mayan source via EOA-submitted payable depositMayan, skipping approve, and reports the native tx (7702)', async () => {
    const NATIVE = '0x0000000000000000000000000000000000000000' as Hex;
    const depositValue = 1_000_000_000_000_000_000n; // 1 ETH
    vi.mocked(createRequestFromIntent).mockResolvedValueOnce({
      depositRequest: {
        sources: [
          {
            universe: 0,
            chainID: BigInt(ARB_CHAIN),
            contractAddress:
              '0x0000000000000000000000000000000000000000000000000000000000000000',
            value: depositValue,
            fee: 0n,
          },
        ],
        destinations: [],
        destinationUniverse: 0,
        destinationChainID: BigInt(BASE_CHAIN),
        recipientAddress:
          '0x000000000000000000000000aaaa000000000000000000000000000000000001',
        nonce: 1n,
        expiry: 2n,
        parties: [],
      },
      rffRequest: { sources: [], destinations: [] } as never,
      signature: '0x1234',
      requestHash: '0xabc123',
    });
    vi.mocked(createCaliburExecuteTxFromCalls).mockResolvedValue({
      to: '0xbbbb000000000000000000000000000000000002' as Hex,
      data: '0xexecute' as Hex,
      value: depositValue,
    });
    const reportMayanNativeTx = vi.fn().mockResolvedValue({ success: true });
    const baseCtx = makeCtx();
    const ctx = {
      ...baseCtx,
      cache: {
        hasAuthCodeSet: vi.fn().mockReturnValue(true), // already delegated → no bootstrap
        markAuthCodeSet: vi.fn(),
      } as unknown as ExecutionContext['cache'],
      destinationDirectEoa: true,
      middlewareClient: { ...baseCtx.middlewareClient, reportMayanNativeTx } as never,
    } as BridgeCtx;
    let currentChainId = 1;
    vi.mocked(ctx.eoaWallet.getChainId).mockImplementation(async () => currentChainId);
    vi.mocked(ctx.eoaWallet.switchChain).mockImplementation(async ({ id }: { id: number }) => {
      currentChainId = id;
    });

    const bridge: NonNullable<SwapRoute['bridge']> = {
      ...makeBridge(),
      tokenAddress: NATIVE,
      decimals: 18,
      provider: 'mayan',
      mayanQuotesBySource: new Map([
        [
          `${ARB_CHAIN}:${NATIVE.toLowerCase()}`,
          { minReceived: 1, deadline64: '2', protocolBps: 3 } as never,
        ],
      ]),
      amounts: { tokenAmount: new Decimal('1'), gasInCot: new Decimal(0), totalAmount: new Decimal('1') },
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    };
    const nativeAsset: BridgeAsset = {
      chainID: ARB_CHAIN,
      contractAddress: NATIVE,
      decimals: 18,
      eoaBalance: new Decimal('1'),
      ephemeralBalance: new Decimal(0),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, [nativeAsset], ctx, metadata);

    // EOA-submitted payable depositMayan carrying native value — not the ERC-20 approve+sponsor flow.
    expect(createCaliburExecuteTxFromCalls).toHaveBeenCalledTimes(1);
    const caliburInput = vi.mocked(createCaliburExecuteTxFromCalls).mock.calls[0]?.[0];
    expect(caliburInput?.value).toBe(depositValue);
    const depositCall = caliburInput!.calls[0];
    expect(depositCall.value).toBe(depositValue);
    expect((depositCall.to as string).toLowerCase()).toBe(
      (ctx.chainList.getVaultContractAddress(ARB_CHAIN) as string).toLowerCase()
    );
    expect(decodeFunctionData({ abi: VAULT_ABI_MAYAN, data: depositCall.data }).functionName).toBe(
      'depositMayan'
    );

    // Reported so the middleware doesn't also try to sponsor-deposit the native leg.
    expect(reportMayanNativeTx).toHaveBeenCalledWith(
      '0xabc123',
      expect.objectContaining({ source_index: 0 })
    );
    expect(waitForFill).toHaveBeenCalledTimes(1);
  });

  it('deposits a native source via dispatchSafeSource carrying value, skipping the ERC-20 5-step batch (non-7702)', async () => {
    // Phase 1b non-7702: native deposit is a single payable Safe.execTransaction{value} dispatched
    // by the EOA (dispatchSafeSource), not the sponsor 5-step transfer/permit/deposit/sweep batch.
    const NATIVE = '0x0000000000000000000000000000000000000000' as Hex;
    const depositValue = 1_000_000_000_000_000_000n;
    vi.mocked(createRequestFromIntent).mockResolvedValueOnce({
      depositRequest: {
        sources: [
          {
            universe: 0,
            chainID: BigInt(ARB_CHAIN),
            contractAddress:
              '0x0000000000000000000000000000000000000000000000000000000000000000',
            value: depositValue,
            fee: 0n,
          },
        ],
        destinations: [],
        destinationUniverse: 0,
        destinationChainID: BigInt(BASE_CHAIN),
        recipientAddress:
          '0x000000000000000000000000aaaa000000000000000000000000000000000001',
        nonce: 1n,
        expiry: 2n,
        parties: [],
      },
      rffRequest: { sources: [], destinations: [] } as never,
      signature: '0x1234',
      requestHash: '0xabc123',
    });
    vi.mocked(dispatchSafeSource).mockResolvedValue({
      txHash: '0xsafe_native_deposit' as Hex,
      safeAddress: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
    });
    const baseCtx = makeCtx();
    const ctx = {
      ...baseCtx,
      chainList: {
        ...baseCtx.chainList,
        getChainByID: vi.fn().mockImplementation((chainId: number) => {
          const chain = baseCtx.chainList.getChainByID(chainId) as Record<string, unknown>;
          if (chainId === ARB_CHAIN) return { ...chain, supports7702: false };
          return chain;
        }),
      } as unknown as ExecutionContext['chainList'],
      destinationDirectEoa: true,
    } as BridgeCtx;
    const bridge: NonNullable<SwapRoute['bridge']> = {
      ...makeBridge(),
      tokenAddress: NATIVE,
      decimals: 18,
      amounts: { tokenAmount: new Decimal('1'), gasInCot: new Decimal(0), totalAmount: new Decimal('1') },
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    };
    const nativeAsset: BridgeAsset = {
      chainID: ARB_CHAIN,
      contractAddress: NATIVE,
      decimals: 18,
      eoaBalance: new Decimal('1'),
      ephemeralBalance: new Decimal(0),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSwapBridge(bridge, [nativeAsset], ctx, metadata);

    expect(dispatchSafeSource).toHaveBeenCalledTimes(1);
    const dispatchArg = vi.mocked(dispatchSafeSource).mock.calls[0]?.[0];
    expect(dispatchArg?.nativeValue).toBe(depositValue);
    expect(dispatchArg?.calls).toHaveLength(1);
    expect(dispatchArg?.calls[0].value).toBe(depositValue);
    expect((dispatchArg?.calls[0].to as string).toLowerCase()).toBe(
      (ctx.chainList.getVaultContractAddress(ARB_CHAIN) as string).toLowerCase()
    );
    expect(decodeFunctionData({ abi: EVMVaultABI, data: dispatchArg!.calls[0].data }).functionName).toBe('deposit');
    // No sponsor 5-step ERC-20 batch and no relayed SBC deposit.
    expect(createSafeExecuteTxFromCalls).not.toHaveBeenCalled();
    expect(createSBCTxFromCalls).not.toHaveBeenCalled();
    expect(waitForFill).toHaveBeenCalledTimes(1);
  });
});
