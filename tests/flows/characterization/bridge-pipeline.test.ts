import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maxUint256, verifyMessage } from 'viem';
import { MESSAGE_PREFIX } from '../../../src/services/rff';
import { makeBridgeCharacterizationHarness } from '../../helpers/bridge-characterization';

const viemBoundary = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: viemBoundary.createPublicClient,
    fallback: vi.fn().mockReturnValue({}),
    http: vi.fn().mockReturnValue({}),
  };
});

const makeHarness = (options?: Parameters<typeof makeBridgeCharacterizationHarness>[0]) => {
  const harness = makeBridgeCharacterizationHarness(options);
  viemBoundary.createPublicClient.mockReturnValue(harness.publicClient);
  return harness;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bridge pipeline characterization', () => {
  it('builds, signs, submits, deposits, and fulfils a bridge through real internals', async () => {
    const harness = makeHarness({ allowanceRaw: maxUint256 });

    const result = await harness.run({
      sourceChains: [harness.sources.primary.chainId],
    });

    expect(result.intent.provider).toBe('nexus');
    expect(result.intent.destination.amount).toBe('1.000000');
    expect(result.intent.selectedSources).toEqual([
      expect.objectContaining({
        amount: '1.000000',
        chain: expect.objectContaining({ id: harness.sources.primary.chainId }),
        token: expect.objectContaining({
          contractAddress: harness.sources.primary.tokenAddress,
        }),
      }),
    ]);

    const submitted = vi.mocked(harness.middlewareClient.submitRFF).mock.calls[0]?.[0];
    expect(submitted).toBeDefined();
    expect(BigInt(submitted!.request.sources[0].chain_id)).toBe(
      BigInt(harness.sources.primary.chainId)
    );
    expect(submitted!.request.sources[0].contract_address.toLowerCase()).toMatch(
      new RegExp(`${harness.sources.primary.tokenAddress.slice(2).toLowerCase()}$`)
    );
    expect(submitted!.request.recipient_address.toLowerCase()).toMatch(
      new RegExp(`${harness.address.slice(2).toLowerCase()}$`)
    );

    const signedMessage = harness.signedMessages[0];
    expect(signedMessage).toMatch(new RegExp(`^${MESSAGE_PREFIX}`));
    await expect(
      verifyMessage({
        address: harness.address,
        message: signedMessage,
        signature: submitted!.signature,
      })
    ).resolves.toBe(true);

    expect(harness.events).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'intent_building' },
        { type: 'status', status: 'intent_ready' },
        expect.objectContaining({ type: 'plan_preview' }),
        { type: 'status', status: 'awaiting_approval' },
        { type: 'status', status: 'approved' },
        expect.objectContaining({ type: 'plan_confirmed' }),
        { type: 'status', status: 'executing' },
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'request_signing',
          state: 'completed',
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'request_submission',
          state: 'completed',
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'vault_deposit',
          state: 'completed',
          step: expect.objectContaining({
            id: expect.stringContaining(harness.sources.primary.tokenAddress.toLowerCase()),
          }),
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'bridge_fill',
          state: 'completed',
        }),
        { type: 'status', status: 'completed' },
      ])
    );
  });

  it('completes a native-token bridge without starting an ERC20 collection watcher', async () => {
    const harness = makeHarness({ asset: 'native' });

    await expect(
      harness.run({
        sourceChains: [harness.sources.primary.chainId],
      })
    ).resolves.toMatchObject({
      intent: {
        destination: {
          amount: '1.000000000000000000',
          token: expect.objectContaining({ symbol: 'ETH' }),
        },
      },
    });

    expect(harness.publicClient.watchContractEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'Deposit' })
    );
    expect(harness.events).toContainEqual({ type: 'status', status: 'completed' });
  });

  it('rebuilds the real intent and preview when the hook refreshes source selection', async () => {
    const harness = makeHarness({ allowanceRaw: maxUint256 });
    const hookIntents: Array<{ sourceChainIds: number[] }> = [];

    const result = await harness.run({
      sourceChains: [],
      onIntent: async ({ allow, intent, refresh }) => {
        hookIntents.push({
          sourceChainIds: intent.selectedSources.map((source) => source.chain.id),
        });
        const refreshed = await refresh([harness.sources.primary.chainId]);
        hookIntents.push({
          sourceChainIds: refreshed.selectedSources.map((source) => source.chain.id),
        });
        allow();
      },
    });

    expect(hookIntents).toEqual([
      { sourceChainIds: [harness.sources.alternate.chainId] },
      { sourceChainIds: [harness.sources.primary.chainId] },
    ]);
    expect(result.intent.selectedSources[0]?.chain.id).toBe(harness.sources.primary.chainId);
    expect(harness.events.filter((event) => event.type === 'plan_preview')).toHaveLength(2);

    const submitted = vi.mocked(harness.middlewareClient.submitRFF).mock.calls[0]?.[0];
    expect(BigInt(submitted!.request.sources[0].chain_id)).toBe(
      BigInt(harness.sources.primary.chainId)
    );
  });

  it('stops before request signing when the real intent hook is denied', async () => {
    const harness = makeHarness({ allowanceRaw: maxUint256 });

    await expect(
      harness.run({
        onIntent: ({ deny }) => deny(),
      })
    ).rejects.toMatchObject({
      code: 'user_action/intent_hook_denied',
    });

    expect(harness.signedMessages).toHaveLength(0);
    expect(harness.middlewareClient.submitRFF).not.toHaveBeenCalled();
  });

  it('emits bridge-fill failure and no completed status when real fulfilment times out', async () => {
    const harness = makeHarness({
      allowanceRaw: maxUint256,
      fillStatus: 'created',
    });

    await expect(
      harness.run({
        fillTimeoutMinutes: 0,
      })
    ).rejects.toMatchObject({
      name: 'BackendError',
      code: 'backend/fulfilment_wait_timeout',
      context: { stepType: 'bridge_fill' },
    });

    expect(harness.events).toContainEqual(
      expect.objectContaining({
        type: 'plan_progress',
        stepType: 'bridge_fill',
        state: 'failed',
      })
    );
    expect(harness.events).not.toContainEqual({ type: 'status', status: 'completed' });
  });
});

describe('bridge allowance hook characterization', () => {
  it('rejects a selection count that does not match real insufficient sources', async () => {
    const harness = makeHarness({ allowanceRaw: 0n });

    await expect(
      harness.run({
        onAllowance: ({ allow }) => allow([]),
      })
    ).rejects.toMatchObject({
      code: 'validation/invalid_allowance_hook',
    });

    expect(harness.middlewareClient.createApprovals).not.toHaveBeenCalled();
  });

  it('rejects when the allowance hook denies a real insufficient source', async () => {
    const harness = makeHarness({ allowanceRaw: 0n });

    await expect(
      harness.run({
        onAllowance: ({ deny }) => deny(),
      })
    ).rejects.toMatchObject({
      code: 'user_action/allowance_approval_denied',
    });

    expect(harness.middlewareClient.createApprovals).not.toHaveBeenCalled();
  });
});
