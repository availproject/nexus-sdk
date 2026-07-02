import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type {
  EthereumProvider,
  BridgeOptions,
  TokenBalance,
  TokenInfo,
} from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { createBridgeIntent } from '../../src/bridge/intent/creator';
import { createUserAssets } from '../../src/services/balances';
import type { MayanQuote, MayanQuoteRequest } from '../../src/transport';
import { makeChain, makeChainList } from '../helpers/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';

/**
 * Coverage summary:
 * - Happy path: builds sources from non-destination chains.
 * - Validation failure: no allowed sources selected after source-chain filtering.
 * - Asset/token failure: token unsupported by provided user assets.
 * - Balance failures:
 *   - non-destination source balances do not meet requested amount;
 *   - requested amount + gasInToken exceeds available source balance;
 *   - selected sources only include destination chain so no borrowable source remains.
 */
describe('createBridgeIntent', () => {
  const token: TokenInfo = {
    contractAddress: '0x0000000000000000000000000000000000000001',
    decimals: 6,
    logo: '',
    name: 'USD Coin',
    symbol: 'USDC',
    mayanEnabled: true,
  };

  const makeProvider = (): EthereumProvider => ({
    request: async () => null,
    on() {
      return this;
    },
    removeListener() {
      return this;
    },
  });

  const makeOptions = (chainList: ReturnType<typeof makeChainList>): BridgeOptions => ({
    evm: {
      address: '0x0000000000000000000000000000000000000002',
      client: {} as BridgeOptions['evm']['client'],
      provider: makeProvider(),
    },
    hooks: {
      onAllowance: () => {},
      onIntent: () => {},
    },
    chainList,
    middlewareClient: makeMiddlewareClient(),
    intentExplorerUrl: 'https://example.com',
  });

  const createIntentContext = (options: BridgeOptions) => ({
    chainList: options.chainList,
    evm: {
      address: options.evm.address,
    },
  });

  const zeroUsdValue = () => new Decimal(0);

  const zeroFeeQuote = (
    srcChainIds: number[],
    dstChainId: number,
    tokenAddress = token.contractAddress
  ) => ({
    fulfillmentBps: 0,
    sources: srcChainIds.map((chainId) => ({
      chainId,
      tokenAddress,
      depositFeeUsd: '0',
      depositFeeToken: '0',
      depositMayanFeeUsd: '0',
      depositMayanFeeToken: '0',
    })),
    destination: {
      chainId: dstChainId,
      tokenAddress,
      fulfillmentFeeUsd: '0',
      fulfillmentFeeToken: '0',
    },
  });

  const makeChainBalance = (input: {
    balance: string;
    chainId: number;
    chainName: string;
    contractAddress?: `0x${string}`;
    decimals?: number;
    symbol?: string;
    universe?: Universe;
    value?: string;
  }) => ({
    balance: input.balance,
    value: input.value ?? '0.00',
    symbol: input.symbol ?? 'USDC',
    chain: { id: input.chainId, logo: '', name: input.chainName },
    contractAddress: input.contractAddress ?? token.contractAddress,
    decimals: input.decimals ?? token.decimals,
    universe: input.universe ?? Universe.ETHEREUM,
  });

  const makeTokenBalance = (input: {
    balance: string;
    chainBalances: Array<ReturnType<typeof makeChainBalance>>;
    decimals?: number;
    logo?: string;
    name?: string;
    symbol?: string;
    value?: string;
  }): TokenBalance => ({
    balance: input.balance,
    value: input.value ?? '0.00',
    chainBalances: input.chainBalances,
    decimals: input.decimals ?? token.decimals,
    logo: input.logo ?? '',
    name: input.name ?? input.symbol ?? 'USDC',
    symbol: input.symbol ?? 'USDC',
  });

  it('builds sources from non-destination chains', async () => {
    const chain1 = makeChain(1, 'Ethereum');
    const chain2 = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '15',
        chainBalances: [
          makeChainBalance({ balance: '10', chainId: chain1.id, chainName: chain1.name }),
          makeChainBalance({ balance: '5', chainId: chain2.id, chainName: chain2.name }),
        ],
      }),
    ];

    const chainList = makeChainList([chain1, chain2], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    const intent = await createBridgeIntent(
      {
        amount: new Decimal('6'),
        assets: userAssets,
        gas: new Decimal('0'),
        gasInToken: new Decimal('0'),
        resolveUsdValue: zeroUsdValue,
        sourceChains: [],
        token,
        dstChainId: chain2.id,
        dstChainUniverse: Universe.ETHEREUM,
        dstChainNativeDecimals: 18,
        recipient: options.evm.address,
        quoteResponse: zeroFeeQuote([1], 10),
        provider: 'nexus',
      },
      createIntentContext(options)
    );

    expect(intent.availableSources).toHaveLength(1);
    expect(intent.availableSources[0]?.chain.id).toBe(chain1.id);
    expect(intent.selectedSources).toHaveLength(1);
    expect(intent.selectedSources[0]?.chain.id).toBe(chain1.id);
    expect(intent.selectedSources[0]?.amount.toFixed()).toBe('6');
    expect(intent.selectedSources[0]?.holderAddress).toBe(options.evm.address);
    expect(intent.selectedSources[0]?.value.toFixed(2)).toBe('0.00');
    expect(intent.destination.amount.toFixed()).toBe('6');
    expect(intent.destination.value.toFixed(2)).toBe('0.00');
    expect(intent.destination.nativeAmountValue.toFixed(2)).toBe('0.00');
  });

  it('excludes Mayan-disabled source chains and source tokens from Mayan source selection', async () => {
    const disabledChain = { ...makeChain(42161, 'Arbitrum'), mayanEnabled: false };
    const disabledTokenChain = makeChain(8453, 'Base');
    const usableChain = makeChain(10, 'Optimism');
    const dstChain = makeChain(137, 'Polygon');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '300',
        value: '300.00',
        chainBalances: [
          makeChainBalance({
            balance: '100',
            value: '100.00',
            chainId: disabledChain.id,
            chainName: disabledChain.name,
          }),
          makeChainBalance({
            balance: '100',
            value: '100.00',
            chainId: disabledTokenChain.id,
            chainName: disabledTokenChain.name,
          }),
          makeChainBalance({
            balance: '100',
            value: '100.00',
            chainId: usableChain.id,
            chainName: usableChain.name,
          }),
        ],
      }),
    ];

    const chainList = makeChainList([disabledChain, disabledTokenChain, usableChain, dstChain], token);
    chainList.getTokenByAddress = (chainId, address) => ({
      ...token,
      contractAddress: address,
      mayanEnabled: chainId !== disabledTokenChain.id,
    });

    let quotedSources: MayanQuoteRequest['sources'] = [];
    const middlewareClient = makeMiddlewareClient({
      getMayanQuotes: async (request) => {
        quotedSources = request.sources;
        return {
          destination: { chainId: dstChain.id, tokenAddress: token.contractAddress },
          quotes: request.sources.map((source) => ({
            source: {
              chainId: Number(BigInt(source.chain_id)),
              tokenAddress: source.contract_address as `0x${string}`,
              amount: source.amount,
            },
            mayanQuote: { minReceived: 5, protocolBps: 0 } as MayanQuote,
          })),
        };
      },
    });

    const intent = await createBridgeIntent(
      {
        amount: new Decimal('5'),
        assets: createUserAssets(assets),
        gas: new Decimal('0'),
        gasInToken: new Decimal('0'),
        resolveUsdValue: ({ amount }) => amount.mul(1),
        sourceChains: [],
        token,
        dstChainId: dstChain.id,
        dstChainUniverse: Universe.ETHEREUM,
        dstChainNativeDecimals: 18,
        recipient: '0x0000000000000000000000000000000000000002',
        quoteResponse: zeroFeeQuote([usableChain.id], dstChain.id),
        provider: 'mayan',
      },
      {
        ...createIntentContext(makeOptions(chainList)),
        middlewareClient,
      }
    );

    expect(intent.provider).toBe('mayan');
    expect(intent.availableSources.map((source) => source.chain.id)).toEqual([usableChain.id]);
    expect(intent.selectedSources.map((source) => source.chain.id)).toEqual([usableChain.id]);
    expect(quotedSources.map((source) => Number(BigInt(source.chain_id)))).toEqual([
      usableChain.id,
    ]);
  });

  describe('Mayan exact-out convergence', () => {
    // Linear Mayan rate mock: minReceived(human) = inputAmount(human) * rate.
    // rate=0.5 is a deliberately steep synthetic haircut: it makes convergence
    // observable AND defeats the legacy 3-attempt proportional loop, so these tests
    // distinguish a real Mayan convergence (provider stays 'mayan') from the Nexus
    // fallback the old loop triggered when it ran out of attempts.
    const makeRateMayanClient = (rate: number) =>
      makeMiddlewareClient({
        getMayanQuotes: async (request) => ({
          destination: {
            chainId: Number(BigInt(request.destination.chain_id)),
            tokenAddress: request.destination.contract_address as `0x${string}`,
          },
          quotes: request.sources.map((source) => ({
            source: {
              chainId: Number(BigInt(source.chain_id)),
              tokenAddress: source.contract_address as `0x${string}`,
              amount: source.amount,
            },
            mayanQuote: {
              minReceived: (Number(source.amount) / 10 ** token.decimals) * rate,
              protocolBps: 0,
            } as MayanQuote,
          })),
        }),
      });

    it('commits the largest leg in full and trims only the last leg to the requested amount', async () => {
      const bigChain = makeChain(42161, 'Arbitrum');
      const swingChain = makeChain(8453, 'Base');
      const dstChain = makeChain(10, 'Optimism');

      const assets: TokenBalance[] = [
        makeTokenBalance({
          balance: '22',
          value: '22.00',
          chainBalances: [
            makeChainBalance({
              balance: '12',
              value: '12.00',
              chainId: bigChain.id,
              chainName: bigChain.name,
            }),
            makeChainBalance({
              balance: '10',
              value: '10.00',
              chainId: swingChain.id,
              chainName: swingChain.name,
            }),
          ],
        }),
      ];

      const chainList = makeChainList([bigChain, swingChain, dstChain], token);
      const options = makeOptions(chainList);

      const intent = await createBridgeIntent(
        {
          amount: new Decimal('7'),
          assets: createUserAssets(assets),
          gas: new Decimal('0'),
          gasInToken: new Decimal('0'),
          resolveUsdValue: ({ amount }) => amount.mul(1),
          sourceChains: [],
          token,
          dstChainId: dstChain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse: zeroFeeQuote([bigChain.id, swingChain.id], dstChain.id),
          provider: 'mayan',
        },
        { ...createIntentContext(options), middlewareClient: makeRateMayanClient(0.5) }
      );

      expect(intent.provider).toBe('mayan');
      const big = intent.selectedSources.find((s) => s.chain.id === bigChain.id)!;
      const swing = intent.selectedSources.find((s) => s.chain.id === swingChain.id)!;
      // big leg (out 6 at full 12) can't cover 7 alone, so it stays at full usable
      expect(big.amount.toFixed()).toBe('12');
      // swing covers residual output 1. The 50% mock is a steep *proportional* fee, so the
      // absolute-haircut seed (which models a FIXED fee) over-sizes here: seed = need 1 +
      // fullHaircut (10−5)=5 → 6 in → 3 out, delivering 9 vs the 7 requested. Pins the known
      // trade-off (real Mayan is mostly fixed — see the fixed-fee test below for clean convergence).
      expect(swing.amount.toFixed()).toBe('6');
      expect(intent.destination.amount.toFixed()).toBe('9');
    });

    it('over-sizes a single source on a steep proportional rate (the absolute-haircut trade-off)', async () => {
      const srcChain = makeChain(42161, 'Arbitrum');
      const dstChain = makeChain(10, 'Optimism');

      const assets: TokenBalance[] = [
        makeTokenBalance({
          balance: '100',
          value: '100.00',
          chainBalances: [
            makeChainBalance({
              balance: '100',
              value: '100.00',
              chainId: srcChain.id,
              chainName: srcChain.name,
            }),
          ],
        }),
      ];

      const chainList = makeChainList([srcChain, dstChain], token);
      const options = makeOptions(chainList);

      const intent = await createBridgeIntent(
        {
          amount: new Decimal('30'),
          assets: createUserAssets(assets),
          gas: new Decimal('0'),
          gasInToken: new Decimal('0'),
          resolveUsdValue: ({ amount }) => amount.mul(1),
          sourceChains: [],
          token,
          dstChainId: dstChain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse: zeroFeeQuote([srcChain.id], dstChain.id),
          provider: 'mayan',
        },
        { ...createIntentContext(options), middlewareClient: makeRateMayanClient(0.5) }
      );

      expect(intent.provider).toBe('mayan');
      expect(intent.selectedSources).toHaveLength(1);
      // Steep 50% *proportional* mock: the absolute-haircut seed (modelling a FIXED fee) over-sizes —
      // seed = need 30 + fullHaircut (100−50)=50 → 80 in → 40 out, delivering 40 vs 30 requested.
      // The documented trade-off; on a mostly-fixed real Mayan fee it converges clean (test below).
      expect(intent.selectedSources[0]!.amount.toFixed()).toBe('80');
      expect(intent.destination.amount.toFixed()).toBe('40');
    });

    it('floors the last leg at the per-leg minimum and overshoots only within that bound', async () => {
      const bigChain = makeChain(42161, 'Arbitrum');
      const swingChain = makeChain(8453, 'Base');
      const dstChain = makeChain(10, 'Optimism');

      // Thin swing (usable 1.2) so the absolute-haircut seed (need 0.4 + fullHaircut 0.6 = 1.0) lands
      // below the per-leg floor (1.1) and gets floored — the case this test guards.
      const assets: TokenBalance[] = [
        makeTokenBalance({
          balance: '13.2',
          value: '13.20',
          chainBalances: [
            makeChainBalance({
              balance: '12',
              value: '12.00',
              chainId: bigChain.id,
              chainName: bigChain.name,
            }),
            makeChainBalance({
              balance: '1.2',
              value: '1.20',
              chainId: swingChain.id,
              chainName: swingChain.name,
            }),
          ],
        }),
      ];

      const chainList = makeChainList([bigChain, swingChain, dstChain], token);
      const options = makeOptions(chainList);

      const intent = await createBridgeIntent(
        {
          amount: new Decimal('6.4'),
          assets: createUserAssets(assets),
          gas: new Decimal('0'),
          gasInToken: new Decimal('0'),
          resolveUsdValue: ({ amount }) => amount.mul(1),
          sourceChains: [],
          token,
          dstChainId: dstChain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse: zeroFeeQuote([bigChain.id, swingChain.id], dstChain.id),
          provider: 'mayan',
        },
        { ...createIntentContext(options), middlewareClient: makeRateMayanClient(0.5) }
      );

      expect(intent.provider).toBe('mayan');
      const swing = intent.selectedSources.find((s) => s.chain.id === swingChain.id)!;
      // residual needed was 0.4 (output), below the per-leg floor → floored to 1.1 input
      expect(swing.amount.toFixed()).toBe('1.1');
      // delivered ≥ requested, overshoot bounded by one min-leg output (1.1 * 0.5 = 0.55)
      expect(intent.destination.amount.gte(new Decimal('6.4'))).toBe(true);
      expect(intent.destination.amount.toFixed(2)).toBe('6.55');
    });

    // Fixed-fee Mayan mock: minReceived(human) = inputAmount(human) − fixedFee. Mayan's cost is mostly
    // a fixed relayer/gas charge, so a smaller leg keeps ~the same absolute fee (a worse effective
    // rate) — exactly the case the rate-based swing seed mishandles.
    const makeFixedFeeMayanClient = (fixedFee: number) =>
      makeMiddlewareClient({
        getMayanQuotes: async (request) => ({
          destination: {
            chainId: Number(BigInt(request.destination.chain_id)),
            tokenAddress: request.destination.contract_address as `0x${string}`,
          },
          quotes: request.sources.map((source) => ({
            source: {
              chainId: Number(BigInt(source.chain_id)),
              tokenAddress: source.contract_address as `0x${string}`,
              amount: source.amount,
            },
            mayanQuote: {
              minReceived: Number(source.amount) / 10 ** token.decimals - fixedFee,
              protocolBps: 0,
            } as MayanQuote,
          })),
        }),
      });

    it('seeds the swing trim from the absolute haircut so it does not undershoot then bump-overshoot', async () => {
      // Ask 120; the source's full usable 127.7 → 126.7 out (fixed fee 1.0). The rate-based seed
      // (120 / bestRate ≈ 120.95) undershoots (119.95 < 120), so the ×1.02 bump jumps to ≈123.42 and
      // commits there → 122.42 delivered, ~2% over (and on a thinner source the bump leaps past
      // `usable` and falls back to the full leg outright). The absolute-haircut seed
      // (120 + fullHaircut 1.0 = 121) clears the target on the first quote → 120 on the nose.
      const srcChain = makeChain(42161, 'Arbitrum');
      const dstChain = makeChain(10, 'Optimism');

      const assets: TokenBalance[] = [
        makeTokenBalance({
          balance: '127.7',
          value: '127.70',
          chainBalances: [
            makeChainBalance({
              balance: '127.7',
              value: '127.70',
              chainId: srcChain.id,
              chainName: srcChain.name,
            }),
          ],
        }),
      ];

      const chainList = makeChainList([srcChain, dstChain], token);
      const options = makeOptions(chainList);

      const intent = await createBridgeIntent(
        {
          amount: new Decimal('120'),
          assets: createUserAssets(assets),
          gas: new Decimal('0'),
          gasInToken: new Decimal('0'),
          resolveUsdValue: ({ amount }) => amount.mul(1),
          sourceChains: [],
          token,
          dstChainId: dstChain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse: zeroFeeQuote([srcChain.id], dstChain.id),
          provider: 'mayan',
        },
        { ...createIntentContext(options), middlewareClient: makeFixedFeeMayanClient(1.0) }
      );

      expect(intent.provider).toBe('mayan');
      expect(intent.selectedSources).toHaveLength(1);
      // Seeded at need + fullHaircut = 121 and committed there — not bumped up to ≈123.42.
      expect(intent.selectedSources[0]!.amount.toFixed()).toBe('121');
      // Delivered hits the target on the nose (121 − 1.0 fee), not the bump's ~122.42 (≈2% over).
      expect(intent.destination.amount.toFixed()).toBe('120');
    });
  });

  it('computes source, destination, and gas USD values from the provided resolver', async () => {
    const srcChain = makeChain(1, 'Ethereum');
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '15',
        value: '15.00',
        chainBalances: [
          makeChainBalance({
            balance: '10',
            value: '10.00',
            chainId: srcChain.id,
            chainName: srcChain.name,
          }),
          makeChainBalance({
            balance: '5',
            value: '5.00',
            chainId: dstChain.id,
            chainName: dstChain.name,
          }),
        ],
      }),
    ];

    const chainList = makeChainList([srcChain, dstChain], token);
    chainList.getNativeToken = () => ({
      contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      decimals: 18,
      logo: '',
      name: 'Ether',
      symbol: 'ETH',
    });
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    const intent = await createBridgeIntent(
      {
        amount: new Decimal('6'),
        assets: userAssets,
        gas: new Decimal('0.01'),
        gasInToken: new Decimal('0.02'),
        resolveUsdValue: ({ amount, symbol }) =>
          symbol === 'ETH' ? amount.mul(2500) : amount.mul(1),
        sourceChains: [],
        token,
        dstChainId: dstChain.id,
        dstChainUniverse: Universe.ETHEREUM,
        dstChainNativeDecimals: 18,
        recipient: options.evm.address,
        quoteResponse: zeroFeeQuote([1], 10),
        provider: 'nexus',
      },
      createIntentContext(options)
    );

    expect(intent.selectedSources[0]?.value.toFixed(2)).toBe('6.02');
    expect(intent.destination.value.toFixed(2)).toBe('6.00');
    expect(intent.destination.nativeAmountValue.toFixed(2)).toBe('25.00');
  });

  it('throws when no allowed sources are selected', async () => {
    const chain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '5',
        chainBalances: [makeChainBalance({ balance: '5', chainId: chain.id, chainName: chain.name })],
      }),
    ];

    const chainList = makeChainList([chain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    await expect(
      createBridgeIntent(
        {
          amount: new Decimal('1'),
          assets: userAssets,
          gas: new Decimal('0'),
          gasInToken: new Decimal('0'),
          resolveUsdValue: zeroUsdValue,
          sourceChains: [1],
          token,
          dstChainId: chain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse: zeroFeeQuote([], 10),
          provider: 'nexus',
        },
        createIntentContext(options)
      )
    ).rejects.toMatchObject({ code: 'validation/invalid_input' });
  });

  it('throws when token is not supported by user assets', async () => {
    const chain = makeChain(10, 'Optimism');
    const chainList = makeChainList([chain], token);
    const userAssets = createUserAssets([]);
    const options = makeOptions(chainList);

    await expect(
      createBridgeIntent(
        {
          amount: new Decimal('1'),
          assets: userAssets,
          gas: new Decimal('0'),
          gasInToken: new Decimal('0'),
          resolveUsdValue: zeroUsdValue,
          sourceChains: [],
          token,
          dstChainId: chain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse: zeroFeeQuote([], 10),
          provider: 'nexus',
        },
        createIntentContext(options)
      )
    ).rejects.toMatchObject({ code: 'validation/token_not_supported' });
  });

  it('throws when total non-destination source balance is insufficient', async () => {
    const srcChain = makeChain(1, 'Ethereum');
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '5',
        chainBalances: [
          makeChainBalance({ balance: '2', chainId: srcChain.id, chainName: srcChain.name }),
          makeChainBalance({ balance: '3', chainId: dstChain.id, chainName: dstChain.name }),
        ],
      }),
    ];

    const chainList = makeChainList([srcChain, dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    await expect(
      createBridgeIntent(
        {
          amount: new Decimal('3'),
          assets: userAssets,
          gas: new Decimal('0'),
          gasInToken: new Decimal('0'),
          resolveUsdValue: zeroUsdValue,
          sourceChains: [],
          token,
          dstChainId: dstChain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse: zeroFeeQuote([1], 10),
          provider: 'nexus',
        },
        createIntentContext(options)
      )
    ).rejects.toMatchObject({ code: 'validation/insufficient_balance' });
  });

  it('throws when required amount including gasInToken exceeds source balances', async () => {
    const srcChain = makeChain(1, 'Ethereum');
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '12',
        chainBalances: [
          makeChainBalance({ balance: '10', chainId: srcChain.id, chainName: srcChain.name }),
          makeChainBalance({ balance: '2', chainId: dstChain.id, chainName: dstChain.name }),
        ],
      }),
    ];

    const chainList = makeChainList([srcChain, dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    await expect(
      createBridgeIntent(
        {
          amount: new Decimal('10'),
          assets: userAssets,
          gas: new Decimal('0'),
          gasInToken: new Decimal('1'),
          resolveUsdValue: zeroUsdValue,
          sourceChains: [],
          token,
          dstChainId: dstChain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse: zeroFeeQuote([1], 10),
          provider: 'nexus',
        },
        createIntentContext(options)
      )
    ).rejects.toMatchObject({ code: 'validation/insufficient_balance' });
  });

  // --- Fee-aware intent creation tests ---

  const makeQuoteResponse = (overrides: {
    fulfillmentBps?: number;
    sources?: Array<{ chainId: number; tokenAddress: `0x${string}`; depositFeeToken: string }>;
    fulfillmentFeeToken?: string;
    dstChainId?: number;
    dstTokenAddress?: `0x${string}`;
  } = {}) => ({
    fulfillmentBps: overrides.fulfillmentBps ?? 10,
    sources: (overrides.sources ?? []).map((s) => ({
      chainId: s.chainId,
      tokenAddress: s.tokenAddress,
      depositFeeUsd: '0',
      depositFeeToken: s.depositFeeToken,
      depositMayanFeeUsd: '0',
      depositMayanFeeToken: s.depositFeeToken,
    })),
    destination: {
      chainId: overrides.dstChainId ?? 10,
      tokenAddress: overrides.dstTokenAddress ?? token.contractAddress,
      fulfillmentFeeUsd: '0',
      fulfillmentFeeToken: overrides.fulfillmentFeeToken ?? '0',
    },
  });

  it('applies protocol BPS and fulfillment fee to payable amount', async () => {
    const srcChain = makeChain(42161, 'Arbitrum');
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '200',
        value: '200.00',
        chainBalances: [
          makeChainBalance({
            balance: '200',
            value: '200.00',
            chainId: srcChain.id,
            chainName: srcChain.name,
          }),
        ],
      }),
    ];

    const chainList = makeChainList([srcChain, dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    // amount=100, gasInToken=0, bps=10 (0.1%), fulfillmentFee=0.5
    // payable = 100 * 1.001 + 0.5 = 100.6
    const quoteResponse = makeQuoteResponse({
      fulfillmentBps: 10,
      fulfillmentFeeToken: '500000',
      sources: [{ chainId: srcChain.id, tokenAddress: token.contractAddress, depositFeeToken: '200000' }],
      dstChainId: dstChain.id,
    });

    const intent = await createBridgeIntent(
      {
        amount: new Decimal('100'),
        assets: userAssets,
        gas: new Decimal('0'),
        gasInToken: new Decimal('0'),
        resolveUsdValue: ({ amount }) => amount.mul(1),
        sourceChains: [],
        token,
        dstChainId: dstChain.id,
        dstChainUniverse: Universe.ETHEREUM,
        dstChainNativeDecimals: 18,
        recipient: options.evm.address,
        quoteResponse,
        provider: 'nexus',
      },
      createIntentContext(options)
    );

    // source used = 100.6 (payable amount), depositFee = 0.2
    expect(intent.selectedSources).toHaveLength(1);
    expect(intent.selectedSources[0]!.amount.toFixed(1)).toBe('100.6');
    expect(intent.selectedSources[0]!.depositFee.toFixed(1)).toBe('0.2');

    // fees
    expect(intent.fees.deposit).toBe('0.2');
    expect(intent.fees.fulfillment).toBe('0.5');
    expect(intent.fees.protocol).toBe(new Decimal(100).mul(new Decimal(10).div(10_000)).toFixed());
    expect(intent.fees.solver).toBe('0');
  });

  it('sorts sources by amount DESC with Ethereum last', async () => {
    const ethChain = makeChain(1, 'Ethereum');
    const arbChain = makeChain(42161, 'Arbitrum');
    const baseChain = makeChain(8453, 'Base');
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '60',
        value: '60.00',
        chainBalances: [
          makeChainBalance({
            balance: '30',
            value: '30.00',
            chainId: ethChain.id,
            chainName: ethChain.name,
          }),
          makeChainBalance({
            balance: '10',
            value: '10.00',
            chainId: arbChain.id,
            chainName: arbChain.name,
          }),
          makeChainBalance({
            balance: '20',
            value: '20.00',
            chainId: baseChain.id,
            chainName: baseChain.name,
          }),
        ],
      }),
    ];

    const chainList = makeChainList([ethChain, arbChain, baseChain, dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    const quoteResponse = makeQuoteResponse({
      fulfillmentBps: 0,
      fulfillmentFeeToken: '0',
      sources: [
        { chainId: ethChain.id, tokenAddress: token.contractAddress, depositFeeToken: '0' },
        { chainId: arbChain.id, tokenAddress: token.contractAddress, depositFeeToken: '0' },
        { chainId: baseChain.id, tokenAddress: token.contractAddress, depositFeeToken: '0' },
      ],
      dstChainId: dstChain.id,
    });

    const intent = await createBridgeIntent(
      {
        amount: new Decimal('55'),
        assets: userAssets,
        gas: new Decimal('0'),
        gasInToken: new Decimal('0'),
        resolveUsdValue: zeroUsdValue,
        sourceChains: [],
        token,
        dstChainId: dstChain.id,
        dstChainUniverse: Universe.ETHEREUM,
        dstChainNativeDecimals: 18,
        recipient: options.evm.address,
        quoteResponse,
        provider: 'nexus',
      },
      createIntentContext(options)
    );

    // Sort: Base(20) before Arb(10) before Eth(30) — amount DESC, Eth last
    // Need 55: Base 20 + Arb 10 + Eth 25
    expect(intent.selectedSources).toHaveLength(3);
    expect(intent.selectedSources[0]!.chain.id).toBe(baseChain.id);
    expect(intent.selectedSources[0]!.amount.toFixed()).toBe('20');
    expect(intent.selectedSources[1]!.chain.id).toBe(arbChain.id);
    expect(intent.selectedSources[1]!.amount.toFixed()).toBe('10');
    expect(intent.selectedSources[2]!.chain.id).toBe(ethChain.id);
    expect(intent.selectedSources[2]!.amount.toFixed()).toBe('25');
  });

  it('skips sources where deposit fee exceeds balance', async () => {
    const cheapChain = makeChain(42161, 'Arbitrum');
    const expensiveChain = makeChain(8453, 'Base');
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '15',
        chainBalances: [
          makeChainBalance({ balance: '10', chainId: cheapChain.id, chainName: cheapChain.name }),
          makeChainBalance({
            balance: '5',
            chainId: expensiveChain.id,
            chainName: expensiveChain.name,
          }),
        ],
      }),
    ];

    const chainList = makeChainList([cheapChain, expensiveChain, dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    const quoteResponse = makeQuoteResponse({
      fulfillmentBps: 0,
      fulfillmentFeeToken: '0',
      sources: [
        { chainId: cheapChain.id, tokenAddress: token.contractAddress, depositFeeToken: '100000' },
        { chainId: expensiveChain.id, tokenAddress: token.contractAddress, depositFeeToken: '6000000' },
      ],
      dstChainId: dstChain.id,
    });

    const intent = await createBridgeIntent(
      {
        amount: new Decimal('5'),
        assets: userAssets,
        gas: new Decimal('0'),
        gasInToken: new Decimal('0'),
        resolveUsdValue: zeroUsdValue,
        sourceChains: [],
        token,
        dstChainId: dstChain.id,
        dstChainUniverse: Universe.ETHEREUM,
        dstChainNativeDecimals: 18,
        recipient: options.evm.address,
        quoteResponse,
        provider: 'nexus',
      },
      createIntentContext(options)
    );

    // expensiveChain (fee=6 >= balance=5) should be skipped
    expect(intent.selectedSources).toHaveLength(1);
    expect(intent.selectedSources[0]!.chain.id).toBe(cheapChain.id);
  });

  it('assigns zero deposit fee to native token sources', async () => {
    // Use mixed sources: one native (0x000...0) and one ERC20
    // The native source should get depositFee=0 without being in the quote response
    const srcChainNative = makeChain(42161, 'Arbitrum');
    const srcChainErc20 = makeChain(8453, 'Base');
    const dstChain = makeChain(10, 'Optimism');

    const erc20Address = '0x0000000000000000000000000000000000000001' as `0x${string}`;
    // Use EADDRESS (0xEEEE...) — recognized as native by isNativeAddress but
    // does not trigger gas estimation in iterateAsset (only ZERO_ADDRESS does)
    const nativeAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as `0x${string}`;

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '20',
        chainBalances: [
          makeChainBalance({
            balance: '10',
            chainId: srcChainNative.id,
            chainName: srcChainNative.name,
            contractAddress: nativeAddress,
          }),
          makeChainBalance({
            balance: '10',
            chainId: srcChainErc20.id,
            chainName: srcChainErc20.name,
            contractAddress: erc20Address,
          }),
        ],
      }),
    ];

    const chainList = makeChainList([srcChainNative, srcChainErc20, dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    const quoteResponse = makeQuoteResponse({
      fulfillmentBps: 0,
      fulfillmentFeeToken: '0',
      sources: [
        { chainId: srcChainErc20.id, tokenAddress: erc20Address, depositFeeToken: '500000' },
      ],
      dstChainId: dstChain.id,
    });

    const intent = await createBridgeIntent(
      {
        amount: new Decimal('15'),
        assets: userAssets,
        gas: new Decimal('0'),
        gasInToken: new Decimal('0'),
        resolveUsdValue: zeroUsdValue,
        sourceChains: [],
        token,
        dstChainId: dstChain.id,
        dstChainUniverse: Universe.ETHEREUM,
        dstChainNativeDecimals: 18,
        recipient: options.evm.address,
        quoteResponse,
        provider: 'nexus',
      },
      createIntentContext(options)
    );

    // Both sources used. Native one should have depositFee=0
    const nativeSrc = intent.selectedSources.find((s) => s.token.contractAddress === nativeAddress);
    const erc20Src = intent.selectedSources.find((s) => s.token.contractAddress === erc20Address);
    expect(nativeSrc).toBeDefined();
    expect(nativeSrc!.depositFee.toFixed()).toBe('0');
    expect(erc20Src).toBeDefined();
    expect(erc20Src!.depositFee.toFixed(1)).toBe('0.5');
  });

  it('scales source value by total debited (used + depositFee)', async () => {
    const srcChain = makeChain(42161, 'Arbitrum');
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '100',
        value: '100.00',
        chainBalances: [
          makeChainBalance({
            balance: '100',
            value: '100.00',
            chainId: srcChain.id,
            chainName: srcChain.name,
          }),
        ],
      }),
    ];

    const chainList = makeChainList([srcChain, dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    const quoteResponse = makeQuoteResponse({
      fulfillmentBps: 0,
      fulfillmentFeeToken: '0',
      sources: [{ chainId: srcChain.id, tokenAddress: token.contractAddress, depositFeeToken: '2000000' }],
      dstChainId: dstChain.id,
    });

    // amount=50 from a 100 balance, depositFee=2
    // value should be 100 * (50 + 2) / 100 = 52
    const intent = await createBridgeIntent(
      {
        amount: new Decimal('50'),
        assets: userAssets,
        gas: new Decimal('0'),
        gasInToken: new Decimal('0'),
        resolveUsdValue: ({ amount }) => amount.mul(1),
        sourceChains: [],
        token,
        dstChainId: dstChain.id,
        dstChainUniverse: Universe.ETHEREUM,
        dstChainNativeDecimals: 18,
        recipient: options.evm.address,
        quoteResponse,
        provider: 'nexus',
      },
      createIntentContext(options)
    );

    expect(intent.selectedSources[0]!.value.toFixed()).toBe('52');
  });

  it('populates depositFee on availableSources entries and excludes destination chain balances', async () => {
    const srcChain = makeChain(42161, 'Arbitrum');
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '20',
        chainBalances: [
          makeChainBalance({ balance: '10', chainId: srcChain.id, chainName: srcChain.name }),
          makeChainBalance({ balance: '10', chainId: dstChain.id, chainName: dstChain.name }),
        ],
      }),
    ];

    const chainList = makeChainList([srcChain, dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    const quoteResponse = makeQuoteResponse({
      fulfillmentBps: 0,
      fulfillmentFeeToken: '0',
      sources: [{ chainId: srcChain.id, tokenAddress: token.contractAddress, depositFeeToken: '300000' }],
      dstChainId: dstChain.id,
    });

    const intent = await createBridgeIntent(
      {
        amount: new Decimal('5'),
        assets: userAssets,
        gas: new Decimal('0'),
        gasInToken: new Decimal('0'),
        resolveUsdValue: zeroUsdValue,
        sourceChains: [],
        token,
        dstChainId: dstChain.id,
        dstChainUniverse: Universe.ETHEREUM,
        dstChainNativeDecimals: 18,
        recipient: options.evm.address,
        quoteResponse,
        provider: 'nexus',
      },
      createIntentContext(options)
    );

    const srcEntry = intent.availableSources.find((s) => s.chain.id === srcChain.id);
    const dstEntry = intent.availableSources.find((s) => s.chain.id === dstChain.id);
    expect(srcEntry!.depositFee.toFixed(1)).toBe('0.3');
    expect(dstEntry).toBeUndefined();
  });

  it('throws insufficient balance when fees eat into available sources', async () => {
    const srcChain = makeChain(42161, 'Arbitrum');
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '10.5',
        chainBalances: [
          makeChainBalance({ balance: '10.5', chainId: srcChain.id, chainName: srcChain.name }),
        ],
      }),
    ];

    const chainList = makeChainList([srcChain, dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    // amount=10, depositFee=0.5 => usable=10. But payable with bps:
    // 10 * 1.001 + 0.1 = 10.11, plus depositFee means we need 10.11 from 10 usable => insufficient
    const quoteResponse = makeQuoteResponse({
      fulfillmentBps: 10,
      fulfillmentFeeToken: '100000',
      sources: [{ chainId: srcChain.id, tokenAddress: token.contractAddress, depositFeeToken: '500000' }],
      dstChainId: dstChain.id,
    });

    await expect(
      createBridgeIntent(
        {
          amount: new Decimal('10'),
          assets: userAssets,
          gas: new Decimal('0'),
          gasInToken: new Decimal('0'),
          resolveUsdValue: zeroUsdValue,
          sourceChains: [],
          token,
          dstChainId: dstChain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse,
          provider: 'nexus',
        },
        createIntentContext(options)
      )
    ).rejects.toMatchObject({ code: 'validation/insufficient_balance' });
  });

  it('throws when selected source chains only include destination chain', async () => {
    const dstChain = makeChain(10, 'Optimism');

    const assets: TokenBalance[] = [
      makeTokenBalance({
        balance: '5',
        chainBalances: [makeChainBalance({ balance: '5', chainId: dstChain.id, chainName: dstChain.name })],
      }),
    ];

    const chainList = makeChainList([dstChain], token);
    const userAssets = createUserAssets(assets);
    const options = makeOptions(chainList);

    await expect(
      createBridgeIntent(
        {
          amount: new Decimal('1'),
          assets: userAssets,
          gas: new Decimal('0'),
          gasInToken: new Decimal('0'),
          resolveUsdValue: zeroUsdValue,
          sourceChains: [dstChain.id],
          token,
          dstChainId: dstChain.id,
          dstChainUniverse: Universe.ETHEREUM,
          dstChainNativeDecimals: 18,
          recipient: options.evm.address,
          quoteResponse: zeroFeeQuote([], 10),
          provider: 'nexus',
        },
        createIntentContext(options)
      )
    ).rejects.toMatchObject({ code: 'validation/invalid_input' });
  });
});
