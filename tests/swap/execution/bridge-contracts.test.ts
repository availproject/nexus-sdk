import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionData, erc20Abi, type Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';

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

import { ERROR_CODES, Errors } from '../../../src/domain/errors';
import { PermitVariant } from '../../../src/domain/permits';
import { createRequestFromIntent } from '../../../src/services/rff';
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
import { decodeSafeRequest } from '../../helpers/swap-characterization';

const ARB_CHAIN = 42161;
const BASE_CHAIN = 8453;
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
const NATIVE = '0x0000000000000000000000000000000000000000' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
const VAULT = '0x9999999999999999999999999999999999999999' as Hex;
const CALIBUR = '0xcccc000000000000000000000000000000000003' as Hex;
const OTHER_CALIBUR = '0xdddd000000000000000000000000000000000004' as Hex;
const TX_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;
const APPROVAL_TX_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex;

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
    permitVariant?: PermitVariant;
    swapSupported?: boolean;
    supports7702?: boolean;
    caliburAddress?: Hex;
    ephemeralCode?: Hex;
    readAllowance?: () => Promise<bigint>;
    waitForTransactionReceipt?: ReturnType<typeof vi.fn>;
  } = {}
) => {
  const readAllowance = overrides.readAllowance ?? vi.fn().mockResolvedValue(0n);
  const readContract = vi.fn().mockImplementation(({ functionName }) => {
    if (functionName === 'allowance') return readAllowance();
    if (functionName === 'name') return 'USD Coin';
    return 0n;
  });
  const createSafeExecuteTx = vi.fn().mockResolvedValue({
    chainId: ARB_CHAIN,
    safeAddress: EPH,
    txHash: TX_HASH,
  });
  const submitSBCs = vi.fn().mockResolvedValue([
    {
      chainId: ARB_CHAIN,
      address: EPH,
      errored: false,
      txHash: APPROVAL_TX_HASH,
    },
  ]);
  const signAuthorization = vi.fn().mockResolvedValue({
    address: CALIBUR,
    chainId: ARB_CHAIN,
    nonce: 7,
    r: `0x${'22'.repeat(32)}`,
    s: `0x${'33'.repeat(32)}`,
    yParity: 1,
  });
  const waitForTransactionReceipt =
    overrides.waitForTransactionReceipt ??
    vi.fn().mockResolvedValue({
      status: 'success',
      transactionHash: APPROVAL_TX_HASH,
    });
  const context = {
    chainList: {
      getChainByID: vi.fn().mockImplementation((chainId: number) => ({
        id: chainId,
        name: chainId === ARB_CHAIN ? 'Arbitrum' : 'Base',
        rpcUrls: { default: { http: ['https://rpc.example'] } },
        nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether' },
        blockExplorers: { default: { url: 'https://explorer.example' } },
        custom: { icon: '' },
        swapSupported: overrides.swapSupported ?? true,
        supports7702: overrides.supports7702 ?? true,
        caliburAddress: overrides.caliburAddress ?? CALIBUR,
      })),
      getVaultContractAddress: vi
        .fn()
        .mockReturnValue(VAULT),
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
        permitVariant: overrides.permitVariant ?? PermitVariant.EIP2612Canonical,
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
      signTypedData: vi.fn().mockResolvedValue(`0x${'11'.repeat(64)}1b`),
      signAuthorization,
    } as unknown as PrivateKeyAccount,
    publicClientList: {
      get: vi.fn().mockReturnValue({
        getCode: vi.fn().mockImplementation(({ address }) =>
          address.toLowerCase() === EPH.toLowerCase()
            ? Promise.resolve(overrides.ephemeralCode)
            : Promise.resolve(undefined)
        ),
        getTransactionCount: vi.fn().mockResolvedValue(7),
        readContract,
        waitForTransactionReceipt,
      }),
    },
    middlewareClient: {
      ...makeSwapExecutionMiddlewareClient({ createSafeExecuteTx }),
      submitSBCs,
    },
    cache: undefined,
    safeAddress: EPH,
    safeDeploymentPromises: new Map([[ARB_CHAIN, Promise.resolve({})]]),
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
    | 'safeAddress'
    | 'safeDeploymentPromises'
    | 'timing'
  >;
  return {
    context,
    createSafeExecuteTx,
    readAllowance,
    readContract,
    signAuthorization,
    submitSBCs,
    waitForTransactionReceipt,
  };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const safeCallNames = (createSafeExecuteTx: ReturnType<typeof vi.fn>) =>
  createSafeExecuteTx.mock.calls.flatMap(([request]) =>
    decodeSafeRequest(request).map((call) => call.fn)
  );

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
      `0x${'11'.repeat(64)}1b`
    );
    vi.mocked(dispatchSafeSource).mockResolvedValue({
      txHash: TX_HASH,
      safeAddress: EPH,
    });
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
    const { context, createSafeExecuteTx } = makeContext({
      preparedExecution: makePreparedTransfer(null),
    });
    const asset = makeAsset({
      eoaBalance: new Decimal('3'),
      ephemeralBalance: new Decimal(0),
    });

    await executeSwapBridge(makeBridge(), [asset], context, metadata());

    expect(createSafeExecuteTx).toHaveBeenCalledTimes(1);
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
    const { context, createSafeExecuteTx } = makeContext({ preparedExecution: lazyPermit() });
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
    expect(createSafeExecuteTx).not.toHaveBeenCalled();
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
    const { context, createSafeExecuteTx } = makeContext({
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
    expect(createSafeExecuteTx).not.toHaveBeenCalled();
  });

  it('keeps a canonical permit in the Safe batch without submitting Calibur', async () => {
    const { context, createSafeExecuteTx, submitSBCs } = makeContext({
      permitVariant: PermitVariant.EIP2612Canonical,
    });

    await executeSwapBridge(makeBridge(), [makeAsset()], context, metadata());

    expect(submitSBCs).not.toHaveBeenCalled();
    expect(safeCallNames(createSafeExecuteTx)).toEqual(['permit', 'deposit']);
  });

  it('uses one exact-value Calibur approval and omits the Safe permit for a permitless token', async () => {
    const readAllowance = vi
      .fn()
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(3_000_000n);
    const { context, createSafeExecuteTx, submitSBCs } = makeContext({
      permitVariant: PermitVariant.Unsupported,
      readAllowance,
    });

    await executeSwapBridge(makeBridge(), [makeAsset()], context, metadata());

    expect(submitSBCs).toHaveBeenCalledTimes(1);
    const [submitted] = submitSBCs.mock.calls[0]![0];
    expect(submitted.calls).toHaveLength(1);
    expect(submitted.calls[0].to).toBe(USDC_ARB);
    const approval = decodeFunctionData({
      abi: erc20Abi,
      data: submitted.calls[0].data,
    });
    expect(approval.functionName).toBe('approve');
    expect(approval.args).toEqual([VAULT, 3_000_000n]);
    expect(safeCallNames(createSafeExecuteTx)).toEqual(['deposit']);
  });

  it('includes authorization to the configured Calibur when the ephemeral is undelegated', async () => {
    const readAllowance = vi
      .fn()
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(3_000_000n);
    const { context, signAuthorization, submitSBCs } = makeContext({
      permitVariant: PermitVariant.Unsupported,
      ephemeralCode: `0xef0100${OTHER_CALIBUR.slice(2)}`,
      readAllowance,
    });

    await executeSwapBridge(makeBridge(), [makeAsset()], context, metadata());

    expect(signAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ contractAddress: CALIBUR })
    );
    const [submitted] = submitSBCs.mock.calls[0]![0];
    expect(submitted.authorizationList).toEqual([
      expect.objectContaining({ address: CALIBUR }),
    ]);
  });

  it('omits authorization only when the ephemeral is delegated to the configured Calibur', async () => {
    const readAllowance = vi
      .fn()
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(3_000_000n);
    const { context, signAuthorization, submitSBCs } = makeContext({
      permitVariant: PermitVariant.Unsupported,
      ephemeralCode: `0xef0100${CALIBUR.slice(2)}`,
      readAllowance,
    });

    await executeSwapBridge(makeBridge(), [makeAsset()], context, metadata());

    expect(signAuthorization).not.toHaveBeenCalled();
    const [submitted] = submitSBCs.mock.calls[0]![0];
    expect(submitted.authorizationList).toBeUndefined();
  });

  it('skips both permit and Calibur when the existing vault allowance is sufficient', async () => {
    const { context, createSafeExecuteTx, submitSBCs } = makeContext({
      permitVariant: PermitVariant.Unsupported,
      readAllowance: vi.fn().mockResolvedValue(3_000_000n),
    });

    await executeSwapBridge(makeBridge(), [makeAsset()], context, metadata());

    expect(submitSBCs).not.toHaveBeenCalled();
    expect(safeCallNames(createSafeExecuteTx)).toEqual(['deposit']);
  });

  it('does not reread allowance after the Calibur approval receipt', async () => {
    const receipt = deferred<{ status: 'success'; transactionHash: Hex }>();
    const readAllowance = vi
      .fn()
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(3_000_000n);
    const waitForTransactionReceipt = vi.fn().mockReturnValue(receipt.promise);
    const { context, createSafeExecuteTx, submitSBCs } = makeContext({
      permitVariant: PermitVariant.Unsupported,
      readAllowance,
      waitForTransactionReceipt,
    });

    const execution = executeSwapBridge(makeBridge(), [makeAsset()], context, metadata());
    await vi.waitFor(() => expect(submitSBCs).toHaveBeenCalledTimes(1));
    expect(createSafeExecuteTx).not.toHaveBeenCalled();

    receipt.resolve({ status: 'success', transactionHash: APPROVAL_TX_HASH });
    await execution;

    expect(readAllowance).toHaveBeenCalledTimes(1);
    expect(createSafeExecuteTx).toHaveBeenCalledTimes(1);
  });

  it('keeps a permitless token unsupported when Calibur or EIP-7702 is unavailable', async () => {
    const { context, createSafeExecuteTx, submitSBCs } = makeContext({
      permitVariant: PermitVariant.Unsupported,
      supports7702: false,
      caliburAddress: undefined,
    });

    await expect(
      executeSwapBridge(makeBridge(), [makeAsset()], context, metadata())
    ).rejects.toMatchObject({ code: ERROR_CODES.TOKEN_NOT_SUPPORTED });

    expect(submitSBCs).not.toHaveBeenCalled();
    expect(createSafeExecuteTx).not.toHaveBeenCalled();
  });

  it('submits a native bridge deposit through the Safe', async () => {
    const value = 1_000_000_000_000_000_000n;
    setDepositRequest(NATIVE, value);
    const { context } = makeContext();
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
  });

  it('ignores legacy chain capability metadata for native Safe deposits', async () => {
    const value = 1_000_000_000_000_000_000n;
    setDepositRequest(NATIVE, value);
    vi.mocked(dispatchSafeSource).mockResolvedValue({
      txHash: TX_HASH,
      safeAddress: '0xacc1ffaf0000000000000000000000000000beef',
    });
    const { context } = makeContext();
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
  });
});
