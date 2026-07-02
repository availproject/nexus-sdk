import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { createSafeMiddlewareClient } from '../../../src/swap/safe/client';

type AxiosLike = {
  post: ReturnType<typeof vi.fn>;
};

const makeAxios = (): AxiosLike => ({ post: vi.fn() });

describe('createSafeMiddlewareClient', () => {
  let axiosLike: AxiosLike;

  beforeEach(() => {
    axiosLike = makeAxios();
  });

  describe('getSafeAccountAddress', () => {
    it('POSTs /api/v1/get-safe-account-address with chainId + owner', async () => {
      axiosLike.post.mockResolvedValue({
        data: {
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111',
          address: '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9',
          factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
          exists: false,
        },
      });
      const client = createSafeMiddlewareClient(axiosLike as never);

      const result = await client.getSafeAccountAddress({
        chainId: 1,
        owner: '0x1111111111111111111111111111111111111111',
      });

      expect(axiosLike.post).toHaveBeenCalledWith(
        '/api/v1/get-safe-account-address',
        {
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111',
        }
      );
      expect(result.exists).toBe(false);
      expect(result.address).toBe('0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9');
    });

    it('throws BackendError on axios failure', async () => {
      axiosLike.post.mockRejectedValue(new Error('network down'));
      const client = createSafeMiddlewareClient(axiosLike as never);

      await expect(
        client.getSafeAccountAddress({
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111',
        })
      ).rejects.toThrow();
    });
  });

  describe('ensureSafeAccount', () => {
    it('POSTs /api/v1/ensure-safe-account with the full 6-field payload', async () => {
      axiosLike.post.mockResolvedValue({
        data: {
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111',
          address: '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9',
          factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
          exists: true,
          deployTxHash: '0xabc' as Hex,
        },
      });
      const client = createSafeMiddlewareClient(axiosLike as never);

      const payload = {
        chainId: 1,
        owner: '0x1111111111111111111111111111111111111111' as Hex,
        safeAddress: '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9' as Hex,
        saltNonce: `0x${'a'.repeat(64)}` as Hex,
        deadline: `0x${'b'.repeat(64)}` as Hex,
        signature: `0x${'c'.repeat(130)}` as Hex,
      };
      const result = await client.ensureSafeAccount(payload);

      expect(axiosLike.post).toHaveBeenCalledWith('/api/v1/ensure-safe-account', payload);
      expect(result.exists).toBe(true);
      expect(result.deployTxHash).toBe('0xabc');
    });

    it('returns response without deployTxHash on race-lost / already-deployed', async () => {
      axiosLike.post.mockResolvedValue({
        data: {
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111',
          address: '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9',
          factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
          exists: true,
        },
      });
      const client = createSafeMiddlewareClient(axiosLike as never);

      const result = await client.ensureSafeAccount({
        chainId: 1,
        owner: '0x1111111111111111111111111111111111111111' as Hex,
        safeAddress: '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9' as Hex,
        saltNonce: `0x${'a'.repeat(64)}` as Hex,
        deadline: `0x${'b'.repeat(64)}` as Hex,
        signature: `0x${'c'.repeat(130)}` as Hex,
      });
      expect(result.exists).toBe(true);
      expect(result.deployTxHash).toBeUndefined();
    });
  });

  describe('createSafeExecuteTx', () => {
    it('POSTs /api/v1/create-safe-execute-tx and returns txHash', async () => {
      axiosLike.post.mockResolvedValue({
        data: {
          chainId: 1,
          safeAddress: '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9',
          txHash: '0xfeed' as Hex,
        },
      });
      const client = createSafeMiddlewareClient(axiosLike as never);

      const payload = {
        chainId: 1,
        safeAddress: '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9' as Hex,
        to: '0xabcdef0123456789abcdef0123456789abcdef01' as Hex,
        value: `0x${'0'.repeat(64)}` as Hex,
        data: '0xdeadbeef' as Hex,
        operation: 0 as 0 | 1,
        safeTxGas: `0x${'0'.repeat(64)}` as Hex,
        baseGas: `0x${'0'.repeat(64)}` as Hex,
        gasPrice: `0x${'0'.repeat(64)}` as Hex,
        gasToken: '0x0000000000000000000000000000000000000000' as Hex,
        refundReceiver: '0x0000000000000000000000000000000000000000' as Hex,
        signature: `0x${'c'.repeat(130)}` as Hex,
      };
      const result = await client.createSafeExecuteTx(payload);

      expect(axiosLike.post).toHaveBeenCalledWith('/api/v1/create-safe-execute-tx', payload);
      expect(result.txHash).toBe('0xfeed');
      expect(result.safeAddress).toBe('0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9');
    });
  });
});
