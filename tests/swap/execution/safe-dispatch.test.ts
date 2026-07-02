import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  decodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { dispatchSafeSource } from '../../../src/swap/execution/safe-dispatch';
import { predictSafeAccountAddress } from '../../../src/swap/safe/predict';
import { safeExecTransactionAbi } from '../../../src/swap/safe/abis';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ephemeralWallet = privateKeyToAccount(PK);
const safeAddress = predictSafeAccountAddress(ephemeralWallet.address).address as Address;
const eoaAddress = '0xeeee000000000000000000000000000000000001' as Address;
const target = '0xabcdef0123456789abcdef0123456789abcdef01' as Address;
const chainId = 999;
const chain = { id: chainId, name: 'test', blockExplorers: { default: { url: 'https://x.test' } } } as never;

const makePublicClient = (overrides?: {
  code?: Hex;
  nonce?: bigint;
  waitStatus?: 'success' | 'reverted';
}) =>
  ({
    getCode: vi.fn().mockResolvedValue(overrides?.code),
    readContract: vi.fn().mockResolvedValue(overrides?.nonce ?? 0n),
    waitForTransactionReceipt: vi
      .fn()
      .mockResolvedValue({ status: overrides?.waitStatus ?? 'success' }),
  }) as unknown as PublicClient;

const makeEoaWallet = (txHash: Hex = '0xfeed' as Hex) =>
  ({
    sendTransaction: vi.fn().mockResolvedValue(txHash),
    switchChain: vi.fn().mockResolvedValue(undefined),
    getChainId: vi.fn().mockResolvedValue(chainId),
  }) as unknown as WalletClient;

const makeMiddleware = (txHash: Hex = '0xdeed' as Hex) => ({
  ensureSafeAccount: vi.fn().mockResolvedValue({
    chainId,
    owner: ephemeralWallet.address,
    address: safeAddress,
    factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as Hex,
    exists: true,
    deployTxHash: '0xabc' as Hex,
  }),
  createSafeExecuteTx: vi.fn().mockResolvedValue({
    chainId,
    safeAddress,
    txHash,
  }),
});

describe('dispatchSafeSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('non-native (sponsor path)', () => {
    it('ensures Safe, then submits via middleware.createSafeExecuteTx', async () => {
      const publicClient = makePublicClient({ code: undefined });
      const middleware = makeMiddleware('0xdeed' as Hex);
      const eoaWallet = makeEoaWallet();

      const result = await dispatchSafeSource({
        chain,
        chainId,
        calls: [{ to: target, value: 0n, data: '0xfeed' }],
        nativeValue: 0n,
        ephemeralWallet,
        eoaWallet,
        eoaAddress,
        publicClient,
        middleware,
      });

      expect(middleware.ensureSafeAccount).toHaveBeenCalledTimes(1);
      expect(middleware.createSafeExecuteTx).toHaveBeenCalledTimes(1);
      expect((eoaWallet.sendTransaction as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
      expect(result.txHash).toBe('0xdeed');
      expect(result.safeAddress).toBe(safeAddress);
    });

    it('skips ensure when Safe already deployed', async () => {
      const publicClient = makePublicClient({ code: '0x60806040' as Hex });
      const middleware = makeMiddleware();

      await dispatchSafeSource({
        chain,
        chainId,
        calls: [{ to: target, value: 0n, data: '0x' }],
        nativeValue: 0n,
        ephemeralWallet,
        eoaWallet: makeEoaWallet(),
        eoaAddress,
        publicClient,
        middleware,
      });

      expect(middleware.ensureSafeAccount).not.toHaveBeenCalled();
      expect(middleware.createSafeExecuteTx).toHaveBeenCalledTimes(1);
    });
  });

  describe('native value (EOA-submit path)', () => {
    it('ensures Safe, then sends execTransaction via eoaWallet.sendTransaction', async () => {
      const publicClient = makePublicClient({ code: undefined });
      const middleware = makeMiddleware();
      const eoaWallet = makeEoaWallet('0xeoa1' as Hex);

      const result = await dispatchSafeSource({
        chain,
        chainId,
        calls: [{ to: target, value: 1_000n, data: '0xdead' }],
        nativeValue: 1_000n,
        ephemeralWallet,
        eoaWallet,
        eoaAddress,
        publicClient,
        middleware,
      });

      expect(middleware.ensureSafeAccount).toHaveBeenCalledTimes(1);
      expect(middleware.createSafeExecuteTx).not.toHaveBeenCalled();
      expect(eoaWallet.sendTransaction).toHaveBeenCalledTimes(1);

      const [sendArgs] = (eoaWallet.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sendArgs.account).toBe(eoaAddress);
      expect(sendArgs.to).toBe(safeAddress);
      expect(sendArgs.value).toBe(1_000n);

      const { functionName } = decodeFunctionData({
        abi: safeExecTransactionAbi,
        data: sendArgs.data,
      });
      expect(functionName).toBe('execTransaction');
      expect(result.txHash).toBe('0xeoa1');
    });

    it('refuses single-call value mismatch (defensive against route drift)', async () => {
      const publicClient = makePublicClient({ code: undefined });
      const middleware = makeMiddleware();
      const eoaWallet = makeEoaWallet();

      await expect(
        dispatchSafeSource({
          chain,
          chainId,
          calls: [{ to: target, value: 100n, data: '0x' }],
          nativeValue: 999n,
          ephemeralWallet,
          eoaWallet,
          eoaAddress,
          publicClient,
          middleware,
        })
      ).rejects.toThrow(/Single-call native value mismatch/);
      expect(eoaWallet.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
