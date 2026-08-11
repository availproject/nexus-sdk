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
import { predictSafeAccountAddressV2 } from '../../../src/swap/safe/predict';
import { safeExecTransactionAbi } from '../../../src/swap/safe/abis';
import type { EnsureSafeAccountV2Response } from '../../../src/swap/safe/types';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ephemeralWallet = privateKeyToAccount(PK);
const eoaAddress = '0xeeee000000000000000000000000000000000001' as Address;
const safeAddress = predictSafeAccountAddressV2(eoaAddress, ephemeralWallet.address)
  .address as Address;
const target = '0xabcdef0123456789abcdef0123456789abcdef01' as Address;
const chainId = 999;
const chain = { id: chainId, name: 'test', blockExplorers: { default: { url: 'https://x.test' } } } as never;
const resolvedDeployment = () =>
  Promise.resolve<EnsureSafeAccountV2Response>({
    chainId,
    eoaAddress,
    ephemeralAddress: ephemeralWallet.address,
    address: safeAddress,
    factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
    exists: true,
  });

const makePublicClient = (overrides?: {
  code?: Hex;
  nonce?: bigint;
  waitStatus?: 'success' | 'reverted';
}) =>
  ({
    call: vi.fn().mockResolvedValue({ data: '0x' }),
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
    eoaAddress,
    ephemeralAddress: ephemeralWallet.address,
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
    it('awaits Safe deployment, then submits via middleware.createSafeExecuteTx', async () => {
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
        safeAddress,
        safeDeploymentPromise: resolvedDeployment(),
      });

      expect(middleware.ensureSafeAccount).not.toHaveBeenCalled();
      expect(middleware.createSafeExecuteTx).toHaveBeenCalledTimes(1);
      expect((eoaWallet.sendTransaction as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
      expect(result.txHash).toBe('0xdeed');
      expect(result.safeAddress).toBe(safeAddress);
    });

    it('awaits a prestarted deployment and does not ensure the Safe twice', async () => {
      const publicClient = makePublicClient({ code: undefined });
      const middleware = makeMiddleware('0xdeed' as Hex);
      let resolveDeployment!: () => void;
      const safeDeploymentPromise = new Promise<EnsureSafeAccountV2Response>((resolve) => {
        resolveDeployment = () =>
          resolve({
            chainId,
            eoaAddress,
            ephemeralAddress: ephemeralWallet.address,
            address: safeAddress,
            factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
            exists: true,
          });
      });

      const dispatch = dispatchSafeSource({
        chain,
        chainId,
        calls: [{ to: target, value: 0n, data: '0xfeed' }],
        nativeValue: 0n,
        ephemeralWallet,
        eoaWallet: makeEoaWallet(),
        eoaAddress,
        publicClient,
        middleware,
        safeAddress,
        safeDeploymentPromise,
      });

      await Promise.resolve();
      expect(middleware.createSafeExecuteTx).not.toHaveBeenCalled();
      resolveDeployment();
      await dispatch;

      expect(middleware.ensureSafeAccount).not.toHaveBeenCalled();
      expect(middleware.createSafeExecuteTx).toHaveBeenCalledTimes(1);
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
        safeAddress,
        safeDeploymentPromise: resolvedDeployment(),
      });

      expect(middleware.ensureSafeAccount).not.toHaveBeenCalled();
      expect(middleware.createSafeExecuteTx).toHaveBeenCalledTimes(1);
    });
  });

  describe('native value (EOA-submit path)', () => {
    it('awaits Safe deployment, then sends execTransaction via eoaWallet.sendTransaction', async () => {
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
        safeAddress,
        safeDeploymentPromise: resolvedDeployment(),
      });

      expect(middleware.ensureSafeAccount).not.toHaveBeenCalled();
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

    it('simulates the exact EOA call before touching the wallet', async () => {
      const publicClient = makePublicClient({ code: undefined });
      vi.mocked(publicClient.call).mockRejectedValueOnce(new Error('quote expired'));
      const eoaWallet = makeEoaWallet();
      const onWalletPrompt = vi.fn();

      await expect(
        dispatchSafeSource({
          chain,
          chainId,
          calls: [{ to: target, value: 1_000n, data: '0xdead' }],
          nativeValue: 1_000n,
          ephemeralWallet,
          eoaWallet,
          eoaAddress,
          publicClient,
          middleware: makeMiddleware(),
          safeAddress,
          safeDeploymentPromise: resolvedDeployment(),
          onWalletPrompt,
        })
      ).rejects.toMatchObject({ code: 'simulation/eth_call_failed' });

      expect(publicClient.call).toHaveBeenCalledWith({
        account: eoaAddress,
        to: safeAddress,
        data: expect.any(String),
        value: 1_000n,
      });
      expect(eoaWallet.getChainId).not.toHaveBeenCalled();
      expect(eoaWallet.switchChain).not.toHaveBeenCalled();
      expect(eoaWallet.sendTransaction).not.toHaveBeenCalled();
      expect(onWalletPrompt).not.toHaveBeenCalled();
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
          safeAddress,
          safeDeploymentPromise: resolvedDeployment(),
        })
      ).rejects.toThrow(/Single-call native value mismatch/);
      expect(eoaWallet.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
