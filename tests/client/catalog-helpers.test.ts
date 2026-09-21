import { makeTokenFetcher } from '../helpers/catalog';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { createNexusClient } from '../../src';
import type { IntentChain, IntentProvider, IntentToken, NexusClient, ProviderTokenGroup, TokenRef } from '../../src';
import { ZERO_ADDRESS } from '../../src/domain';
import { Errors } from '../../src/domain/errors';
import { testChains } from '../fixtures/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';

const A = '0x00000000000000000000000000000000000000ab';
const B = '0x00000000000000000000000000000000000000cd';
const BOTH: IntentProvider[] = ['relay', 'mayan'];
const ref = (chainId: number, tokenAddress: Hex = A): TokenRef => ({ chainId, tokenAddress });

const token = (chainId: number, address: Hex, asSource: IntentProvider[], asDestination: IntentProvider[]): IntentToken => ({
  chainId, address, symbol: address === ZERO_ADDRESS ? 'ETH' : 'TOKEN', name: 'Display token',
  decimals: address === ZERO_ADDRESS ? 18 : address === B ? 8 : 6,
  isNative: address === ZERO_ADDRESS, logo: 'https://example.com/token.png',
  providers: [...new Set([...asSource, ...asDestination])].map((id) => ({ id })),
  asSource: asSource.map((id) => ({ id })), asDestination: asDestination.map((id) => ({ id })),
});

const chain = (id: number, asSource: IntentProvider[], asDestination: IntentProvider[], tokens: IntentToken[]): IntentChain => ({
  ...testChains[0]!, id, name: `Chain ${id}`, providers: BOTH, asSource, asDestination, tokens,
});

const catalog = (): IntentChain[] => [
  chain(1, [], BOTH, [token(1, A, [], BOTH), token(1, B, [], ['relay']), token(1, ZERO_ADDRESS, [], ['mayan'])]),
  chain(10, BOTH, [], [token(10, A, BOTH, BOTH), token(10, B, ['relay'], []), token(10, ZERO_ADDRESS, ['mayan'], [])]),
  // Token support alone cannot override the chain's directional support.
  chain(8453, ['mayan'], ['mayan'], [token(8453, A, ['mayan'], ['relay']), token(8453, B, ['relay'], [])]),
  chain(137, ['relay'], [], [token(137, A, ['mayan'], [])]),
  chain(56, [], [], [token(56, A, BOTH, BOTH)]),
];

const clients: NexusClient[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.destroy()); });

const setup = async (chains = catalog()) => {
  const reachedQuote = Errors.backend('Quote requested');
  const getIntentChains = vi.fn(async () => chains);
  const getIntentQuote = vi.fn().mockRejectedValue(reachedQuote);
  const getIntentBalances = vi.fn();
  const client = createNexusClient({ clientId: 'catalog-test', analytics: { enabled: false },
    internal: { middlewareClient: makeMiddlewareClient({ getIntentTokens: makeTokenFetcher(chains), getIntentChains, getIntentQuote, getIntentBalances }) } });
  clients.push(client);
  await client.initialize();
  return { client, chains, getIntentChains, getIntentQuote, getIntentBalances, reachedQuote };
};

const addresses = (chains: IntentChain[]) => chains.map(({ id, tokens }) => ({ chainId: id, tokens: tokens.map(({ address }) => address) }));

describe('public on-demand token selection helpers', () => {
  it('groups source candidates by provider using both chain and token support', async () => {
    const { client, getIntentChains, getIntentQuote, getIntentBalances } = await setup();
    const result = (await client.getAvailableSourceTokens(ref(1))).groups;
    expectTypeOf(result).toEqualTypeOf<ProviderTokenGroup[]>();
    expect(result.map(({ provider, chains }) => ({ provider, chains: addresses(chains) }))).toEqual([
      { provider: 'relay', chains: [{ chainId: 10, tokens: [A, B] }] },
      { provider: 'mayan', chains: [{ chainId: 10, tokens: [A, ZERO_ADDRESS] }, { chainId: 8453, tokens: [A] }] },
    ]);
    expect(result[0]!.chains[0]).toMatchObject({ name: 'Chain 10', asSource: BOTH });
    expect(client.hasEvmProvider).toBe(false);
    expect(getIntentChains).toHaveBeenCalledExactlyOnceWith();
    expect(getIntentQuote).not.toHaveBeenCalled();
    expect(getIntentBalances).not.toHaveBeenCalled();
  });

  it('narrows subsequent source choices while retaining already-selected tokens', async () => {
    const { client } = await setup();
    expect((await client.getAvailableSourceTokens(ref(1), [])).groups).toEqual((await client.getAvailableSourceTokens(ref(1))).groups);
    expect((await client.getAvailableSourceTokens(ref(1), [ref(10)])).groups.map(({ provider }) => provider)).toEqual(BOTH);
    const narrowed = (await client.getAvailableSourceTokens(ref(1), [ref(10, B)])).groups;
    expect(narrowed.map(({ provider }) => provider)).toEqual(['relay']);
    expect(addresses(narrowed[0]!.chains)).toEqual([{ chainId: 10, tokens: [A, B] }]);
    expect((await client.getAvailableSourceTokens(ref(1), [ref(10, B), ref(8453)])).groups).toEqual([]);
    // Looking up a narrowed selection must not mutate later calls or cached metadata.
    expect((await client.getAvailableSourceTokens(ref(1))).groups.map(({ provider }) => provider)).toEqual(BOTH);
  });

  it('returns destinations compatible with every selected source in one deduplicated list', async () => {
    const { client } = await setup();
    const both = (await client.getAvailableDestinationTokens([ref(10), ref(10)])).chains;
    expectTypeOf(both).toEqualTypeOf<IntentChain[]>();
    expect(addresses(both)).toEqual([{ chainId: 1, tokens: [A, B, ZERO_ADDRESS] }]);
    expect(addresses((await client.getAvailableDestinationTokens([ref(10), ref(8453)])).chains)).toEqual([
      { chainId: 1, tokens: [A, ZERO_ADDRESS] },
    ]);
    expect((await client.getAvailableDestinationTokens([ref(10, B), ref(8453)])).chains).toEqual([]);
    expect((await client.getAvailableDestinationTokens([])).chains).toEqual(both);
  });

  it('confirms a shared provider across the entire selection rather than separate matches', async () => {
    const { client } = await setup();
    expectTypeOf((await client.confirmRouteExists([ref(10)], ref(1)))).toEqualTypeOf<boolean>();
    expect((await client.confirmRouteExists([ref(10), ref(10, B)], ref(1)))).toBe(true);
    expect((await client.confirmRouteExists([ref(10, B)], ref(1)))).toBe(true);
    expect((await client.confirmRouteExists([ref(8453)], ref(1)))).toBe(true);
    expect((await client.confirmRouteExists([ref(10, B), ref(8453)], ref(1)))).toBe(false);
    expect((await client.confirmRouteExists([ref(137)], ref(1)))).toBe(false);
    expect((await client.confirmRouteExists([ref(10)], ref(8453)))).toBe(false);
  });

  it('matches addresses case-insensitively and keeps native-token support', async () => {
    const { client } = await setup();
    const upper = A.replace('ab', 'AB') as Hex;
    expect((await client.confirmRouteExists([ref(10, upper)], ref(1, upper)))).toBe(true);
    expect((await client.getAvailableSourceTokens(ref(1, upper), [ref(10, upper)])).groups)
      .toEqual((await client.getAvailableSourceTokens(ref(1), [ref(10)])).groups);
    expect((await client.confirmRouteExists([ref(10, ZERO_ADDRESS)], ref(1, ZERO_ADDRESS)))).toBe(true);
  });

  it('returns false for empty selections or unsupported chain/token references', async () => {
    const { client } = await setup();
    expect((await client.confirmRouteExists([], ref(1)))).toBe(false);
    expect((await client.confirmRouteExists([ref(999)], ref(1)))).toBe(false);
    expect((await client.confirmRouteExists([ref(10)], ref(999)))).toBe(false);
    expect((await client.confirmRouteExists([ref(10, '0x1234')], ref(1)))).toBe(false);
    expect((await client.confirmRouteExists([ref(10)], ref(1, '0x1234')))).toBe(false);
  });

  it('preserves display metadata and directional provider objects when listing chain tokens', async () => {
    const { client, chains } = await setup();
    const result = (await client.getTokensByChain(10)).tokens;
    expectTypeOf(result).toEqualTypeOf<IntentToken[]>();
    expect(result).toEqual(chains[1]!.tokens);
    expect(result[1]).toMatchObject({ address: B, decimals: 8, logo: 'https://example.com/token.png',
      asSource: [{ id: 'relay' }], asDestination: [] });
  });

  it('retains all providers without changing the initialized catalog', async () => {
    const chains = catalog();
    const original = structuredClone(chains);
    const { client } = await setup(chains);
    expect((await client.getAvailableSourceTokens(ref(1))).groups.map(({ provider }) => provider)).toEqual(BOTH);
    expect((await client.getAvailableSourceTokens(ref(1), [ref(10, B)])).groups.map(({ provider }) => provider)).toEqual(['relay']);
    expect(addresses((await client.getAvailableDestinationTokens([ref(10, B)])).chains)).toEqual([{ chainId: 1, tokens: [A, B] }]);
    expect(addresses((await client.getAvailableDestinationTokens([])).chains)).toEqual([{ chainId: 1, tokens: [A, B, ZERO_ADDRESS] }]);
    expect((await client.confirmRouteExists([ref(10, B)], ref(1)))).toBe(true);
    expect((await client.confirmRouteExists([ref(10)], ref(1)))).toBe(true);
    expect((await client.getTokensByChain(10)).tokens.map(({ address }) => address)).toEqual([A, B, ZERO_ADDRESS]);
    expect(chains).toEqual(original);
  });

  it.each(['chain', 'token'] as const)('respects explicit empty %s directions and legacy missing directions', async (level) => {
    const chains = catalog();
    const source = level === 'chain' ? chains[1]! : chains[1]!.tokens[0]!;
    const destination = level === 'chain' ? chains[0]! : chains[0]!.tokens[0]!;
    delete source.asSource;
    delete destination.asDestination;
    let { client } = await setup(chains);
    expect((await client.confirmRouteExists([ref(10)], ref(1)))).toBe(true);
    source.asSource = [];
    client = (await setup(chains)).client;
    expect((await client.confirmRouteExists([ref(10)], ref(1)))).toBe(false);
    expect((await client.getAvailableDestinationTokens([ref(10)])).chains).toEqual([]);
    delete source.asSource;
    destination.asDestination = [];
    client = (await setup(chains)).client;
    expect((await client.confirmRouteExists([ref(10)], ref(1)))).toBe(false);
    expect((await client.getAvailableSourceTokens(ref(1))).groups).toEqual([]);
  });

  it('keeps lookup errors typed while treating an empty catalog as having no routes', async () => {
    const { client } = await setup([]);
    expect((await client.getAvailableDestinationTokens([])).chains).toEqual([]);
    expect((await client.confirmRouteExists([ref(10)], ref(1)))).toBe(false);
    await expect(client.getTokensByChain(999)).rejects.toThrowError(expect.objectContaining({ code: 'validation/chain_not_found' }));
    await expect(client.getAvailableSourceTokens(ref(999))).rejects.toThrowError(expect.objectContaining({ code: 'validation/chain_not_found' }));
    const loaded = (await setup()).client;
    await expect(loaded.getAvailableDestinationTokens([ref(10, '0x1234')])).rejects.toThrowError(expect.objectContaining({ code: 'validation/token_not_supported' }));
  });

  it('requires initialization for every asynchronous helper', async () => {
    const client = createNexusClient({ clientId: 'catalog-test', analytics: { enabled: false } });
    clients.push(client);
    const calls = [async () => (await client.getAvailableSourceTokens(ref(1))).groups, async () => (await client.getAvailableDestinationTokens([])).chains,
      async () => (await client.getTokensByChain(1)).tokens, async () => (await client.confirmRouteExists([], ref(1)))];
    for (const call of calls) await expect(call()).rejects.toThrowError(expect.objectContaining({ code: 'validation/sdk_not_initialized' }));
  });

  it('agrees with exact-input prechecks and leaves quote provider selection to middleware', async () => {
    const { client, getIntentQuote, reachedQuote } = await setup();
    await client.setEVMProvider({ on: vi.fn(), removeListener: vi.fn(),
      request: vi.fn(async ({ method }) => method === 'eth_accounts' ? [A] : '0x1') });
    const sources = [ref(10, B), ref(8453)];
    expect((await client.confirmRouteExists(sources, ref(1)))).toBe(false);
    await expect(client.swapWithExactIn({ toChainId: 1, toTokenAddress: A,
      sources: sources.map((source) => ({ ...source, amountRaw: 1n })) })).rejects.toMatchObject({ code: 'validation/invalid_input' });
    expect(getIntentQuote).not.toHaveBeenCalled();
    const chosen = (await client.getAvailableSourceTokens(ref(1), [ref(10, B)])).groups[0]!.chains[0]!.tokens[0]!;
    const selected = [ref(chosen.chainId, chosen.address), ref(10, B)];
    expect((await client.confirmRouteExists(selected, ref(1)))).toBe(true);
    await expect(client.swapWithExactIn({ toChainId: 1, toTokenAddress: A,
      sources: selected.map((source) => ({ ...source, amountRaw: 1n })) })).rejects.toBe(reachedQuote);
    expect(getIntentQuote.mock.calls[0]![0]).not.toHaveProperty('preferredProviders');
  });
});
