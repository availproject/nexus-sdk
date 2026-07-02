import { describe, expect, it, vi } from 'vitest';
import { ZERO_ADDRESS, type ChainListType } from '../../src/domain';
import { PermitVariant } from '../../src/domain/permits';
import { getPermitVariantAndVersion } from '../../src/services/permits';

const DEPLOYMENT_MULTICALL_ADDRESS = '0x00000000000000000000000000000000000000aa' as const;
const TOKEN = '0x0000000000000000000000000000000000000001' as const;

describe('getPermitVariantAndVersion', () => {
  it('detects canonical permit support from multicall probes and reads version from the same batch', async () => {
    const chainList = {
      getChainByID: vi.fn().mockReturnValue({ multicallAddress: DEPLOYMENT_MULTICALL_ADDRESS }),
      getTokenByAddress: vi.fn().mockImplementation(() => {
        throw new Error('Token not found');
      }),
    } as unknown as ChainListType;
    const publicClient = {
      multicall: vi.fn().mockResolvedValue([
        { result: `0x${'11'.repeat(32)}`, status: 'success' },
        { result: 0n, status: 'success' },
        { result: '2', status: 'success' },
      ]),
    };

    const result = await getPermitVariantAndVersion({
      chainId: 137,
      tokenAddress: TOKEN,
      chainList,
      publicClient: publicClient as any,
    });

    const [call] = publicClient.multicall.mock.calls[0];
    expect(call.multicallAddress).toBe(DEPLOYMENT_MULTICALL_ADDRESS);
    expect(call.allowFailure).toBe(true);
    expect(call.contracts).toEqual([
      expect.objectContaining({
        address: TOKEN,
        functionName: 'DOMAIN_SEPARATOR',
      }),
      expect.objectContaining({
        address: TOKEN,
        functionName: 'nonces',
        args: [ZERO_ADDRESS],
      }),
      expect.objectContaining({
        address: TOKEN,
        functionName: 'version',
      }),
    ]);
    expect(result).toEqual({
      permitVariant: PermitVariant.EIP2612Canonical,
      permitContractVersion: 2,
    });
  });

  it('returns unsupported when the canonical permit probe fails', async () => {
    const chainList = {
      getChainByID: vi.fn().mockReturnValue({ multicallAddress: DEPLOYMENT_MULTICALL_ADDRESS }),
      getTokenByAddress: vi.fn().mockImplementation(() => {
        throw new Error('Token not found');
      }),
    } as unknown as ChainListType;
    const publicClient = {
      multicall: vi.fn().mockResolvedValue([
        { error: new Error('missing DOMAIN_SEPARATOR'), status: 'failure' },
        { result: 0n, status: 'success' },
        { result: '1', status: 'success' },
      ]),
    };

    const result = await getPermitVariantAndVersion({
      chainId: 137,
      tokenAddress: TOKEN,
      chainList,
      publicClient: publicClient as any,
    });

    expect(result).toEqual({
      permitVariant: PermitVariant.Unsupported,
      permitContractVersion: 0,
    });
  });
});
