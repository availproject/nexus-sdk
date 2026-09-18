import { type Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { ARC_USDC_ERC20_INTERFACE } from '../../src/domain/constants/addresses';
import { createChainList } from '../../src/services/chain-list';
import { sweepEphemeralRefundsToEoa } from '../../src/services/init-refund-sweep';
import { CurrencyID } from '../../src/swap/cot';
import { cleanupStrandedCot } from '../../src/swap/execution/failure-cleanup';
import type { CreateSafeExecuteTxV2Request } from '../../src/swap/safe/types';
import type { PublicClientList } from '../../src/swap/types';
import { testDeployment } from '../fixtures/deployment';
import { makeSwapMiddlewareClient } from '../helpers/middleware-client';
import { makeDeterministicPublicClient } from '../helpers/public-client';
import {
  decodeSafeRequest,
  EOA,
  EPH_ACCOUNT,
  PREDICTED_SAFE,
} from '../helpers/swap-characterization';

const setup = ({
  knownInterface = false,
  nativeRefund = 5n * 10n ** 18n + 7n,
  safeBalance = 0n,
} = {}) => {
  const chainId = 5042;
  const chain = testDeployment.chains[0];
  const chainList = createChainList({
    ...testDeployment,
    chains: [
      {
        ...chain,
        chainId,
        name: 'Arc',
        nativeCurrency: {
          ...chain.nativeCurrency,
          name: 'USD Coin',
          symbol: 'USDC',
          currencyId: 1,
        },
        tokens: knownInterface
          ? [
              {
                ...chain.tokens[0],
                address: ARC_USDC_ERC20_INTERFACE,
                permitVariant: 1,
                permitVersion: 2,
              },
            ]
          : [],
      },
    ],
  });
  const balanceOf = (holder: Hex) =>
    holder === EPH_ACCOUNT.address ? nativeRefund : holder === PREDICTED_SAFE ? safeBalance : 0n;
  const read = ({
    functionName,
    args = [],
  }: {
    functionName: string;
    args?: readonly unknown[];
  }) => {
    if (functionName === 'getEthBalance') return balanceOf(args[0] as Hex);
    if (functionName === 'balanceOf') return balanceOf(args[0] as Hex) / 10n ** 12n;
    if (functionName === 'name') return 'USDC';
    if (functionName === 'version') return '2';
    if (functionName === 'DOMAIN_SEPARATOR') return `0x${'11'.repeat(32)}`;
    if (functionName === 'nonces' || functionName === 'nonce') return 0n;
    throw new Error(`Unexpected read: ${functionName}`);
  };
  const publicClient = {
    ...makeDeterministicPublicClient({ readContract: read }),
    getCode: vi.fn().mockResolvedValue('0x6000'),
    getBalance: vi.fn(async ({ address }: { address: Hex }) => balanceOf(address)),
    multicall: vi.fn(async ({ contracts }: { contracts: Array<Parameters<typeof read>[0]> }) =>
      contracts.map((contract) => ({ status: 'success', result: read(contract) }))
    ),
    sendRawTransaction: vi.fn(),
  };
  const createSafeExecuteTx = vi.fn(async (_request: CreateSafeExecuteTxV2Request) => ({
    chainId,
    safeAddress: PREDICTED_SAFE,
    txHash: `0x${'ab'.repeat(32)}` as Hex,
  }));
  const ephemeralWallet = { ...EPH_ACCOUNT };
  vi.spyOn(ephemeralWallet, 'signTypedData');
  vi.spyOn(ephemeralWallet, 'signTransaction');
  const ctx = {
    chainList,
    middlewareClient: makeSwapMiddlewareClient({ createSafeExecuteTx }),
    publicClientList: { get: () => publicClient } as unknown as PublicClientList,
    ephemeralWallet,
    eoaAddress: EOA,
    safeAddress: PREDICTED_SAFE,
    cache: undefined,
    destinationChainId: 8453,
    destinationDirectEoa: true,
    safeDeploymentPromises: new Map(),
  };
  return { ctx, publicClient, createSafeExecuteTx };
};

describe('sponsored Arc native refund recovery', () => {
  it.each([
    'init',
    'failure',
  ] as const)('pulls refunded USDC from ephemeral through its ERC-20 interface during %s cleanup', async (stage) => {
    const { ctx, publicClient, createSafeExecuteTx } = setup();
    if (stage === 'init') await sweepEphemeralRefundsToEoa({ ctx });
    else
      await cleanupStrandedCot({
        ctx,
        currencyId: CurrencyID.USDC,
        chainIds: [5042],
        scope: 'source',
      });

    expect(createSafeExecuteTx).toHaveBeenCalledTimes(1);
    const calls = decodeSafeRequest(createSafeExecuteTx.mock.calls[0][0]);
    expect(calls.map((call) => call.fn)).toEqual(['permit', 'transferFrom']);
    expect(calls.map((call) => call.to.toLowerCase())).toEqual([
      ARC_USDC_ERC20_INTERFACE,
      ARC_USDC_ERC20_INTERFACE,
    ]);
    expect(calls[0].args.slice(0, 3)).toEqual([EPH_ACCOUNT.address, PREDICTED_SAFE, 5_000_000n]);
    expect(calls[1].args).toEqual([EPH_ACCOUNT.address, EOA, 5_000_000n]);
    expect(calls.every((call) => call.value === 0n)).toBe(true);
    expect(ctx.ephemeralWallet.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryType: 'Permit',
        domain: expect.objectContaining({
          verifyingContract: ARC_USDC_ERC20_INTERFACE,
          version: '2',
        }),
      })
    );
    expect(ctx.ephemeralWallet.signTransaction).not.toHaveBeenCalled();
    expect(publicClient.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each([
    'init',
    'failure',
  ] as const)('returns Safe native funds and ephemeral refunds once in one batch during %s cleanup', async (stage) => {
    const safeBalance = 2n * 10n ** 18n + 9n;
    const { ctx, createSafeExecuteTx } = setup({ knownInterface: true, safeBalance });
    if (stage === 'init') await sweepEphemeralRefundsToEoa({ ctx });
    else
      await cleanupStrandedCot({
        ctx,
        currencyId: CurrencyID.USDC,
        chainIds: [5042],
        scope: 'source',
      });

    expect(createSafeExecuteTx).toHaveBeenCalledTimes(1);
    const calls = decodeSafeRequest(createSafeExecuteTx.mock.calls[0][0]);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ to: EOA, value: safeBalance });
    expect(calls.slice(1).map((call) => call.fn)).toEqual(['permit', 'transferFrom']);
    expect(calls[2].args[2]).toBe(5_000_000n);
  });

  it('does not spend gas or round up when only sub-micro-USDC dust remains at ephemeral', async () => {
    const { ctx, createSafeExecuteTx, publicClient } = setup({ nativeRefund: 10n ** 12n - 1n });
    await sweepEphemeralRefundsToEoa({ ctx });
    expect(createSafeExecuteTx).not.toHaveBeenCalled();
    expect(ctx.ephemeralWallet.signTransaction).not.toHaveBeenCalled();
    expect(publicClient.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each([
    'init',
    'failure',
  ] as const)('still returns Safe funds if the ephemeral permit probe fails during %s cleanup', async (stage) => {
    const { ctx, createSafeExecuteTx, publicClient } = setup({ safeBalance: 9n });
    const multicall = publicClient.multicall.getMockImplementation()!;
    publicClient.multicall.mockImplementation(async (request) => {
      if (request.contracts[0].functionName === 'DOMAIN_SEPARATOR')
        throw new Error('RPC unavailable');
      return multicall(request);
    });
    if (stage === 'init') await sweepEphemeralRefundsToEoa({ ctx });
    else
      await cleanupStrandedCot({
        ctx,
        currencyId: CurrencyID.USDC,
        chainIds: [5042],
        scope: 'source',
      });

    expect(createSafeExecuteTx).toHaveBeenCalledTimes(1);
    expect(decodeSafeRequest(createSafeExecuteTx.mock.calls[0][0])).toEqual([
      { to: EOA, value: 9n, fn: 'unknown(0x)', args: [] },
    ]);
    expect(ctx.ephemeralWallet.signTypedData).not.toHaveBeenCalledWith(
      expect.objectContaining({ primaryType: 'Permit' })
    );
    expect(ctx.ephemeralWallet.signTransaction).not.toHaveBeenCalled();
    expect(publicClient.sendRawTransaction).not.toHaveBeenCalled();
  });
});
