import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, erc20Abi, type Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';

vi.mock('../../../src/services/sbc', () => ({
  createSBCTxFromCalls: vi.fn(),
  createCaliburExecuteTxFromCalls: vi.fn(),
  requireSuccessfulSbcResult: vi.fn(
    (
      results: Array<
        | { chainId: number; errored: false; txHash: Hex }
        | { chainId: number; errored: true; message: string }
      >,
      chainId: number
    ) => {
      const result = results.find((entry) => entry.chainId === chainId);
      if (!result || result.errored) throw new Error(result?.message ?? 'submission failed');
      return result.txHash;
    }
  ),
}));

vi.mock('../../../src/bridge/executor', () => ({
  submitRFFToMiddleware: vi.fn().mockResolvedValue('0xrequest'),
  waitForFill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/bridge/hooks/approval', () => ({
  runBridgeHooks: vi.fn().mockImplementation(async (intent) => ({
    intent,
    insufficientAllowanceSources: [],
    allowanceSelections: [],
  })),
}));

vi.mock('../../../src/services/rff', () => ({
  createRequestFromIntent: vi.fn(),
}));

vi.mock('../../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn(),
}));

vi.mock('../../../src/swap/execution/safe-dispatch', () => ({
  dispatchSafeSource: vi.fn(),
}));

import { Errors } from '../../../src/domain/errors';
import { createRequestFromIntent } from '../../../src/services/rff';
import {
  createCaliburExecuteTxFromCalls,
  createSBCTxFromCalls,
} from '../../../src/services/sbc';
import { signPermitForAddressAndValue } from '../../../src/services/allowance-utils';
import { executeSwapBridge } from '../../../src/swap/execution/bridge';
import { dispatchSafeSource } from '../../../src/swap/execution/safe-dispatch';
import type {
  BridgeAsset,
  ExecutionContext,
  PreparedSwapExecution,
  SwapMetadata,
  SwapRoute,
} from '../../../src/swap/types';
import { makeSwapExecutionMiddlewareClient } from '../../helpers/middleware-client';

const ARB_CHAIN = 42161;
const BASE_CHAIN = 8453;
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
const NATIVE = '0x0000000000000000000000000000000000000000' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
const TX_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;

const makeAsset = (
  overrides: Partial<BridgeAsset> = {}
): BridgeAsset => ({
  chainID: ARB_CHAIN,
  contractAddress: USDC_ARB,
  decimals: 6,
  eoaBalance: new Decimal(0),
  ephemeralBalance: new Decimal('3'),
  ...overrides,
});

const makeBridge = (
  overrides: Partial<NonNullable<SwapRoute['bridge']>> = {}
): NonNullable<SwapRoute['bridge']> => ({
  provider: 'nexus',
  amount: new Decimal('3'),
  amounts: {
    tokenAmount: new Decimal('3'),
    gasInCot: new Decimal(0),
    totalAmount: new Decimal('3'),
  },
  assets: [makeAsset()],
  chainID: BASE_CHAIN,
  decimals: 6,
  tokenAddress: USDC_BASE,
  estimatedFees: {
    collection: new Decimal(0),
    fulfilment: new Decimal(0),
    caGas: new Decimal(0),
    protocol: new Decimal(0),
    solver: new Decimal(0),
  },
  ...overrides,
});

const makePreparedTransfer = (
  authorization: PreparedSwapExecution['eoaToEphemeralTransfers'][number]['authorization']
): PreparedSwapExecution => ({
  parsedQuotes: [],
  eoaToEphemeralTransfers: [
    {
      reason: 'bridge',
      chainId: ARB_CHAIN,
      tokenAddress: USDC_ARB,
      amount: 3_000_000n,
      targetAddress: EPH,
      authorization,
      transferCall: {
        to: USDC_ARB,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transferFrom',
          args: [EOA, EPH, 3_000_000n],
        }),
        value: 0n,
      },
    },
  ],
});

const lazyPermit = () =>
  makePreparedTransfer({
    kind: 'permit',
    call: null,
    permit: {
      signature: null,
      permitVariant: 1,
      permitContractVersion: 2,
    },
  });

const makeContext = (
  overrides: {
    preparedExecution?: PreparedSwapExecution;
    supports7702?: boolean;
  } = {}
) => {
  const readContract = vi.fn().mockResolvedValue(0n);
  const submitSBCs = vi.fn().mockResolvedValue([
    {
      chainId: ARB_CHAIN,
      address: EPH,
      errored: false as const,
      txHash: TX_HASH,
    },
  ]);
  const context = {
    chainList: {
      getChainByID: vi.fn().mockImplementation((chainId: number) => ({
        id: chainId,
        name: chainId === ARB_CHAIN ? 'Arbitrum' : 'Base',
        supports7702:
          chainId === ARB_CHAIN ? (overrides.supports7702 ?? true) : true,
        rpcUrls: { default: { http: ['https://rpc.example'] } },
        nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether' },
        blockExplorers: { default: { url: 'https://explorer.example' } },
        custom: { icon: '' },
      })),
      getVaultContractAddress: vi
        .fn()
        .mockReturnValue('0x9999999999999999999999999999999999999999'),
      getNativeToken: vi.fn().mockReturnValue({
        contractAddress: NATIVE,
        decimals: 18,
        symbol: 'ETH',
        name: 'Ether',
        logo: '',
      }),
      getTokenByAddress: vi.fn().mockImplementation((_chainId: number, address: Hex) => ({
        contractAddress: address,
        decimals: address === NATIVE ? 18 : 6,
        symbol: address === NATIVE ? 'ETH' : 'USDC',
        name: address === NATIVE ? 'Ether' : 'USD Coin',
        logo: '',
        permitVariant: 1,
        permitVersion: 2,
      })),
    },
    eoaAddress: EOA,
    eoaWallet: {
      getChainId: vi.fn().mockResolvedValue(ARB_CHAIN),
      switchChain: vi.fn().mockResolvedValue(undefined),
      addChain: vi.fn().mockResolvedValue(undefined),
      writeContract: vi.fn().mockResolvedValue(TX_HASH),
      sendTransaction: vi.fn().mockResolvedValue(TX_HASH),
    },
    ephemeralWallet: {
      address: EPH,
      signTypedData: vi.fn().mockResolvedValue(`0x${'11'.repeat(65)}`),
      signAuthorization: vi.fn(),
    } as unknown as PrivateKeyAccount,
    publicClientList: {
      get: vi.fn().mockReturnValue({
        getCode: vi.fn().mockResolvedValue(undefined),
        readContract,
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: 'success',
          transactionHash: TX_HASH,
        }),
      }),
    },
    middlewareClient: makeSwapExecutionMiddlewareClient({ submitSBCs }),
    cache: undefined,
    intentExplorerUrl: 'https://intent.example',
    onProgress: vi.fn(),
    preparedExecution: overrides.preparedExecution,
    destinationDirectEoa: true,
  } as unknown as Pick<
    ExecutionContext,
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
  return { context, readContract, submitSBCs };
};

const metadata = (): SwapMetadata => ({
  src: [],
  dst: null,
  has_xcs: false,
  intent_request_hash: null,
});

const setDepositRequest = (
  contractAddress: Hex = USDC_ARB,
  value = 3_000_000n
) => {
  vi.mocked(createRequestFromIntent).mockResolvedValue({
    depositRequest: {
      sources: [
        {
          universe: 0,
          chainID: BigInt(ARB_CHAIN),
          contractAddress: `0x${'0'.repeat(24)}${contractAddress.slice(2)}`,
          value,
          fee: 0n,
        },
      ],
      destinations: [],
      destinationUniverse: 0,
      destinationChainID: BigInt(BASE_CHAIN),
      recipientAddress: `0x${'0'.repeat(24)}${EOA.slice(2)}`,
      nonce: 1n,
      expiry: 2n,
      parties: [],
    },
    rffRequest: { sources: [], destinations: [] },
    signature: '0x1234',
    requestHash: '0xrequest',
  } as never);
};

describe('executeSwapBridge contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDepositRequest();
    vi.mocked(signPermitForAddressAndValue).mockResolvedValue(
      `0x${'11'.repeat(65)}`
    );
    vi.mocked(createSBCTxFromCalls).mockResolvedValue({
      chainId: ARB_CHAIN,
      address: EPH,
      calls: [],
      deadline: '0x01',
      keyHash: '0x00',
      nonce: '0x01',
      revertOnFailure: true,
      signature: '0x1234',
    } as never);
  });

  it('fails with step context when an EOA-held asset has no prepared funding transfer', async () => {
    const { context } = makeContext({
      preparedExecution: { parsedQuotes: [], eoaToEphemeralTransfers: [] },
    });
    const asset = makeAsset({
      eoaBalance: new Decimal('3'),
      ephemeralBalance: new Decimal(0),
    });

    await expect(
      executeSwapBridge(makeBridge(), [asset], context, metadata())
    ).rejects.toMatchObject({
      context: expect.objectContaining({
        chainId: ARB_CHAIN,
        stepType: 'eoa_to_ephemeral_transfer',
      }),
    });
  });

  it('uses a prepared transfer with no authorization without retrying', async () => {
    const { context, submitSBCs } = makeContext({
      preparedExecution: makePreparedTransfer(null),
    });
    const asset = makeAsset({
      eoaBalance: new Decimal('3'),
      ephemeralBalance: new Decimal(0),
    });

    await executeSwapBridge(makeBridge(), [asset], context, metadata());

    expect(submitSBCs).toHaveBeenCalledTimes(1);
    expect(context.eoaWallet.writeContract).not.toHaveBeenCalled();
  });

  it('retries a plain transient permit preparation error three times', async () => {
    const { context } = makeContext({ preparedExecution: lazyPermit() });
    vi.mocked(signPermitForAddressAndValue).mockRejectedValue(
      new Error('RPC unavailable')
    );
    const asset = makeAsset({
      eoaBalance: new Decimal('3'),
      ephemeralBalance: new Decimal(0),
    });

    await expect(
      executeSwapBridge(makeBridge(), [asset], context, metadata())
    ).rejects.toThrow('RPC unavailable');

    expect(signPermitForAddressAndValue).toHaveBeenCalledTimes(3);
  });

  it('retries a categorized RPC error and stamps funding step context', async () => {
    const { context } = makeContext({ preparedExecution: lazyPermit() });
    vi.mocked(signPermitForAddressAndValue).mockRejectedValue(
      Errors.execution('RPC unavailable', { service: 'rpc' })
    );
    const asset = makeAsset({
      eoaBalance: new Decimal('3'),
      ephemeralBalance: new Decimal(0),
    });

    await expect(
      executeSwapBridge(makeBridge(), [asset], context, metadata())
    ).rejects.toMatchObject({
      context: expect.objectContaining({
        chainId: ARB_CHAIN,
        stepType: 'eoa_to_ephemeral_transfer',
      }),
    });
  });

  it('does not retry a rejected permit signature', async () => {
    const { context, submitSBCs } = makeContext({ preparedExecution: lazyPermit() });
    const rejection = Errors.userRejectedAllowance();
    vi.mocked(signPermitForAddressAndValue).mockRejectedValue(rejection);
    const asset = makeAsset({
      eoaBalance: new Decimal('3'),
      ephemeralBalance: new Decimal(0),
    });

    await expect(
      executeSwapBridge(makeBridge(), [asset], context, metadata())
    ).rejects.toMatchObject({ code: rejection.code });

    expect(signPermitForAddressAndValue).toHaveBeenCalledTimes(1);
    expect(submitSBCs).not.toHaveBeenCalled();
  });

  it('does not retry direct approval failures', async () => {
    const approval = {
      kind: 'approve' as const,
      call: {
        to: USDC_ARB,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [EPH, 3_000_000n],
        }),
        value: 0n,
      },
      permit: null,
    };
    const { context, submitSBCs } = makeContext({
      preparedExecution: makePreparedTransfer(approval),
    });
    vi.mocked(context.eoaWallet.writeContract).mockRejectedValue(
      new Error('approval failed')
    );
    const asset = makeAsset({
      eoaBalance: new Decimal('3'),
      ephemeralBalance: new Decimal(0),
    });

    await expect(
      executeSwapBridge(makeBridge(), [asset], context, metadata())
    ).rejects.toThrow('approval failed');

    expect(context.eoaWallet.writeContract).toHaveBeenCalledTimes(1);
    expect(submitSBCs).not.toHaveBeenCalled();
  });

  it('submits a native bridge deposit through a payable Calibur execute on 7702', async () => {
    const value = 1_000_000_000_000_000_000n;
    setDepositRequest(NATIVE, value);
    vi.mocked(createCaliburExecuteTxFromCalls).mockResolvedValue({
      to: EPH,
      data: '0x1234',
      value,
    });
    const { context } = makeContext();
    context.cache = {
      hasAuthCodeSet: vi.fn().mockReturnValue(false),
      markAuthCodeSet: vi.fn(),
    } as unknown as ExecutionContext['cache'];
    const asset = makeAsset({
      contractAddress: NATIVE,
      decimals: 18,
      eoaBalance: new Decimal('1'),
      ephemeralBalance: new Decimal(0),
    });
    const bridge = makeBridge({
      tokenAddress: NATIVE,
      decimals: 18,
      assets: [asset],
    });

    await executeSwapBridge(bridge, [asset], context, metadata());

    expect(createCaliburExecuteTxFromCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        calls: [expect.objectContaining({ value })],
        value,
      })
    );
    expect(context.eoaWallet.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value })
    );
  });

  it('dispatches a native bridge deposit through the Safe on non-7702', async () => {
    const value = 1_000_000_000_000_000_000n;
    setDepositRequest(NATIVE, value);
    vi.mocked(dispatchSafeSource).mockResolvedValue({
      txHash: TX_HASH,
      safeAddress: '0xacc1ffaf0000000000000000000000000000beef',
    });
    const { context } = makeContext({ supports7702: false });
    const asset = makeAsset({
      contractAddress: NATIVE,
      decimals: 18,
      eoaBalance: new Decimal('1'),
      ephemeralBalance: new Decimal(0),
    });
    const bridge = makeBridge({
      tokenAddress: NATIVE,
      decimals: 18,
      assets: [asset],
    });

    await executeSwapBridge(bridge, [asset], context, metadata());

    expect(dispatchSafeSource).toHaveBeenCalledWith(
      expect.objectContaining({
        calls: [expect.objectContaining({ value })],
        nativeValue: value,
      })
    );
    expect(createCaliburExecuteTxFromCalls).not.toHaveBeenCalled();
  });
});
