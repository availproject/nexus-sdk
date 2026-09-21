import { makeTokenFetcher } from '../helpers/catalog';
import { describe, expect, it, vi } from 'vitest';
import { createBase } from '../../src/core/sdk/base';
import { Errors } from '../../src/domain/errors';
import type { IntentChain, IntentProvider, IntentSource } from '../../src/intent/types';
import { normalizeIntentQuote } from '../../src/intent/normalize';
import { createChainList } from '../../src/services/chain-list';
import { testChains } from '../fixtures/chains';
import { sponsoredQuoteResponse } from '../fixtures/better-intent';
import { makeMiddlewareClient } from '../helpers/middleware-client';

const TOKEN = '0x0000000000000000000000000000000000000002';
const OTHER_TOKEN = '0x00000000000000000000000000000000000000ab';
const ACCOUNT = '0x00000000000000000000000000000000000000aa';
const destination = { toChainId: 1, toTokenAddress: TOKEN } as const;
const source = (chainId: number): IntentSource & { tokenAddress: typeof TOKEN; amountRaw: bigint } =>
  ({ chainId, tokenAddress: TOKEN, amountRaw: 10n });

const chain = (id: number, asSource: IntentProvider[], asDestination: IntentProvider[]): IntentChain => ({
  ...testChains[0], id,
  providers: ['nexus-v2', 'mayan', 'relay'], asSource, asDestination,
  tokens: [{
    ...testChains[0].tokens[1], chainId: id,
    providers: [{ id: 'nexus-v2' }, { id: 'mayan' }, { id: 'relay' }],
    asSource: asSource.map((id) => ({ id })),
    asDestination: asDestination.map((id) => ({ id })),
  }],
});

const setup = async (chains: IntentChain[]) => {
  const reachedQuote = Errors.backend('Quote requested');
  const getIntentQuote = vi.fn().mockRejectedValue(reachedQuote);
  const getIntentChains = vi.fn();
  const getIntentBalances = vi.fn();
  const getIntentTokens = vi.fn(makeTokenFetcher(chains));
  const base = createBase({
    clientId: 'test-client', network: 'mainnet',
    internal: { middlewareClient: makeMiddlewareClient({ getIntentTokens, getIntentQuote, getIntentChains, getIntentBalances }) },
  });
  base.setIntentCatalog(chains);
  base.setChainList(createChainList(chains));
  const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_accounts' ? [ACCOUNT] : '0x1');
  await base.setEvmProvider({ request, on: vi.fn(), removeListener: vi.fn() });
  return { base, getIntentTokens, getIntentQuote, getIntentChains, getIntentBalances, reachedQuote, request };
};

describe('cached provider checks before quoting', () => {
  it('requires one provider shared by every exact-input source and the destination', async () => {
    const ctx = await setup([
      chain(1, [], ['relay', 'mayan']), chain(10, ['relay'], []), chain(8453, ['mayan'], []),
    ]);
    await expect(ctx.base.swapWithExactIn({ ...destination, sources: [source(10), source(8453)] }))
      .rejects.toMatchObject({ code: 'validation/invalid_input', message: expect.stringMatching(/common provider/i) });
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.request).toHaveBeenCalledTimes(2);
  });

  it('quotes exact input when all legs share a provider without fetching catalogs or balances', async () => {
    const ctx = await setup([
      chain(1, [], ['relay']), chain(10, ['relay', 'mayan'], []), chain(8453, ['relay'], []),
    ]);
    await expect(ctx.base.swapWithExactIn({ ...destination, sources: [source(10), source(8453)] }))
      .rejects.toBe(ctx.reachedQuote);
    expect(ctx.getIntentQuote).toHaveBeenCalledWith(expect.objectContaining({ input: [
      { chainId: 'EVM_10', token: TOKEN, amount: '10' },
      { chainId: 'EVM_8453', token: TOKEN, amount: '10' },
    ] }), undefined);
    expect(ctx.getIntentChains).not.toHaveBeenCalled();
    expect(ctx.getIntentBalances).not.toHaveBeenCalled();
  });

  it.each(['chain', 'token'] as const)('respects empty %s source support instead of its provider union', async (level) => {
    const src = chain(10, ['relay'], []);
    if (level === 'chain') src.asSource = [];
    else src.tokens[0].asSource = [];
    const ctx = await setup([chain(1, [], ['relay']), src]);
    await expect(ctx.base.swapWithExactIn({ ...destination, sources: [source(10)] }))
      .rejects.toMatchObject({ code: 'validation/invalid_input' });
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
  });

  it.each(['chain', 'token'] as const)('checks %s destination support', async (level) => {
    const dst = chain(1, ['relay'], ['relay']);
    if (level === 'chain') dst.asDestination = [];
    else dst.tokens[0].asDestination = [];
    const ctx = await setup([dst, chain(10, ['relay'], [])]);
    await expect(ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n }))
      .rejects.toMatchObject({ code: 'validation/invalid_input' });
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
  });

  it('filters explicitly selected exact-output candidates', async () => {
    const sources = [source(10), source(8453)];
    const ctx = await setup([
      chain(1, [], ['relay']), chain(10, ['relay'], []), chain(8453, ['mayan'], []),
    ]);
    await expect(ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n, sources }))
      .rejects.toBe(ctx.reachedQuote);
    expect(ctx.getIntentQuote).toHaveBeenCalledWith(expect.objectContaining({
      sources: [{ chainId: 'EVM_10', tokens: [TOKEN] }],
    }), undefined);
    expect(ctx.getIntentChains).not.toHaveBeenCalled();
    expect(ctx.getIntentBalances).not.toHaveBeenCalled();
  });

  it('keeps exact-output alternatives even when different sources use different providers', async () => {
    const ctx = await setup([
      chain(1, [], ['relay', 'mayan']), chain(10, ['relay'], []), chain(8453, ['mayan'], []),
    ]);
    await expect(ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n, sources: [source(10), source(8453)] }))
      .rejects.toBe(ctx.reachedQuote);
    expect(ctx.getIntentQuote).toHaveBeenCalledWith(expect.objectContaining({ sources: [
      { chainId: 'EVM_10', tokens: [TOKEN] }, { chainId: 'EVM_8453', tokens: [TOKEN] },
    ] }), undefined);
  });

  it('groups and deduplicates exact-output tokens by chain while preserving user filters', async () => {
    const src = chain(10, ['relay'], []);
    src.tokens.push({ ...src.tokens[0], address: OTHER_TOKEN });
    const ctx = await setup([chain(1, [], ['relay']), src]);
    await expect(ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n, sources: [source(10), source(10)] }))
      .rejects.toBe(ctx.reachedQuote);
    expect(ctx.getIntentQuote).toHaveBeenLastCalledWith(expect.objectContaining({ sources: [
      { chainId: 'EVM_10', tokens: [TOKEN] },
    ] }), undefined);
    await expect(ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n, sources: [source(10), { chainId: 10, tokenAddress: OTHER_TOKEN }] }))
      .rejects.toBe(ctx.reachedQuote);
    expect(ctx.getIntentQuote).toHaveBeenLastCalledWith(expect.objectContaining({ sources: [
      { chainId: 'EVM_10', tokens: [TOKEN, OTHER_TOKEN] },
    ] }), undefined);
  });

  it.each([undefined, []])('leaves automatic wallet source discovery to the API (%#)', async (sources) => {
    const ctx = await setup([chain(1, [], ['relay']), chain(10, ['relay'], [])]);
    await expect(ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n, sources }))
      .rejects.toBe(ctx.reachedQuote);
    expect(ctx.getIntentQuote.mock.calls[0][0]).not.toHaveProperty('sources');
    expect(ctx.getIntentTokens).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      chainId: 1, contract: TOKEN, limit: 1,
    }));
  });

  it('preserves broad chain filters without enumerating that chain’s tokens', async () => {
    const ctx = await setup([chain(1, [], ['relay']), chain(10, ['relay'], [])]);
    await expect(ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n, sources: [{ chainId: 10 }] }))
      .rejects.toBe(ctx.reachedQuote);
    expect(ctx.getIntentQuote.mock.calls[0][0].sources).toEqual([{ chainId: 'EVM_10' }]);
    expect(ctx.getIntentTokens).toHaveBeenCalledOnce();
  });

  it('errors when every selected source is filtered instead of broadening to all sources', async () => {
    const ctx = await setup([
      chain(1, [], ['relay']), chain(10, ['relay'], []), chain(8453, ['mayan'], []),
    ]);
    await expect(ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n, sources: [source(8453)] }))
      .rejects.toMatchObject({ code: 'validation/invalid_input', message: expect.stringMatching(/no source/i) });
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
  });

  it.each(['nexus-v2', 'mayan', 'relay'] as const)('allows %s without pinning the quote provider', async (provider) => {
    const ctx = await setup([chain(1, [], [provider]), chain(10, [provider], [])]);
    await expect(ctx.base.swapWithExactIn({ ...destination, sources: [source(10)] }))
      .rejects.toBe(ctx.reachedQuote);
    await expect(ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n, sources: [source(10)] }))
      .rejects.toBe(ctx.reachedQuote);
    expect(ctx.getIntentQuote).toHaveBeenCalledTimes(2);
    for (const [request] of ctx.getIntentQuote.mock.calls) {
      expect(request).not.toHaveProperty('preferredProviders');
    }
  });

  it.each(['exactInput', 'exactOutput'] as const)('rechecks sources when refreshing %s quotes', async (mode) => {
    const ctx = await setup([
      chain(1, [], ['relay']), chain(10, ['relay'], []), chain(8453, ['mayan'], []),
    ]);
    ctx.getIntentQuote.mockResolvedValue(normalizeIntentQuote(sponsoredQuoteResponse()));
    const onIntent = vi.fn(async ({ refresh, deny }: import('../../src').IntentHookData) => {
      await expect(refresh([source(8453)])).rejects.toMatchObject({ code: 'validation/invalid_input' });
      deny();
    });
    const options = { hooks: { onIntent } };
    const running = mode === 'exactInput'
      ? ctx.base.swapWithExactIn({ ...destination, sources: [source(10)] }, options)
      : ctx.base.swapWithExactOut({ ...destination, toAmountRaw: 10n, sources: [source(10)] }, options);
    await expect(running).rejects.toMatchObject({ code: 'user_action/intent_hook_denied' });
    expect(onIntent).toHaveBeenCalledOnce();
    expect(ctx.getIntentQuote).toHaveBeenCalledOnce();
    expect(ctx.getIntentChains).not.toHaveBeenCalled();
  });
});
