import { describe, expect, it, vi } from 'vitest';
import { type ChainListType, SUPPORTED_CHAINS, type VSCClient } from '../../src/commons';
import { resolveChainExecutions } from '../../src/swap/route';
import { SAFE_PROXY_FACTORY } from '../../src/swap/safe.constants';
import { predictSafeAccountAddress } from '../../src/swap/safetx';

const EPHEMERAL = '0x2222222222222222222222222222222222222222' as const;

const makeChainList = (
  chains: Array<{ id: number; pectraUpgradeSupport: boolean }>
): ChainListType =>
  ({
    getChainByID: (id: number) => {
      const found = chains.find((c) => c.id === id);
      if (!found) return undefined;
      return {
        id: found.id,
        pectraUpgradeSupport: found.pectraUpgradeSupport,
        swapSupported: true,
      } as never;
    },
  }) as unknown as ChainListType;

describe('resolveChainExecutions', () => {
  it('returns 7702 wrapper synchronously for pectra chains and does not call VSC', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const { executions, verification } = resolveChainExecutions({
      chainIds: [SUPPORTED_CHAINS.ETHEREUM],
      ephemeralAddress: EPHEMERAL,
      chainList: makeChainList([{ id: SUPPORTED_CHAINS.ETHEREUM, pectraUpgradeSupport: true }]),
      vscClient,
    });

    expect(executions[SUPPORTED_CHAINS.ETHEREUM]).toEqual({
      address: EPHEMERAL,
      entryPoint: null,
      mode: '7702',
    });
    expect(vscClient.vscGetSafeAccountAddress).not.toHaveBeenCalled();
    await expect(verification).resolves.toBeUndefined();
  });

  it('uses the locally-predicted Safe address for non-pectra chains and verifies via VSC', async () => {
    const expected = predictSafeAccountAddress(EPHEMERAL);
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn().mockResolvedValue({
        address: expected,
        factoryAddress: SAFE_PROXY_FACTORY,
        exists: false,
      }),
    } as Partial<VSCClient> as VSCClient;

    const { executions, verification } = resolveChainExecutions({
      chainIds: [SUPPORTED_CHAINS.HYPEREVM],
      ephemeralAddress: EPHEMERAL,
      chainList: makeChainList([{ id: SUPPORTED_CHAINS.HYPEREVM, pectraUpgradeSupport: false }]),
      vscClient,
    });

    // Returned synchronously without awaiting VSC.
    expect(executions[SUPPORTED_CHAINS.HYPEREVM]).toEqual({
      address: expected,
      entryPoint: null,
      factoryAddress: SAFE_PROXY_FACTORY,
      mode: 'safe_account',
    });
    expect(vscClient.vscGetSafeAccountAddress).toHaveBeenCalledWith(
      SUPPORTED_CHAINS.HYPEREVM,
      EPHEMERAL
    );
    await expect(verification).resolves.toBeUndefined();
  });

  it('throws on the verification promise if the server reports a different Safe address', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn().mockResolvedValue({
        address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        factoryAddress: SAFE_PROXY_FACTORY,
        exists: true,
      }),
    } as Partial<VSCClient> as VSCClient;

    const { verification } = resolveChainExecutions({
      chainIds: [SUPPORTED_CHAINS.HYPEREVM],
      ephemeralAddress: EPHEMERAL,
      chainList: makeChainList([{ id: SUPPORTED_CHAINS.HYPEREVM, pectraUpgradeSupport: false }]),
      vscClient,
    });

    await expect(verification).rejects.toThrow(/Safe address mismatch/);
  });

  it('deduplicates repeated chain ids and only calls VSC once per non-pectra chain', () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn().mockResolvedValue({
        address: predictSafeAccountAddress(EPHEMERAL),
        factoryAddress: SAFE_PROXY_FACTORY,
        exists: true,
      }),
    } as Partial<VSCClient> as VSCClient;

    resolveChainExecutions({
      chainIds: [
        SUPPORTED_CHAINS.HYPEREVM,
        SUPPORTED_CHAINS.HYPEREVM,
        SUPPORTED_CHAINS.ETHEREUM,
        SUPPORTED_CHAINS.HYPEREVM,
      ],
      ephemeralAddress: EPHEMERAL,
      chainList: makeChainList([
        { id: SUPPORTED_CHAINS.HYPEREVM, pectraUpgradeSupport: false },
        { id: SUPPORTED_CHAINS.ETHEREUM, pectraUpgradeSupport: true },
      ]),
      vscClient,
    });

    expect(vscClient.vscGetSafeAccountAddress).toHaveBeenCalledTimes(1);
  });
});
