import type { BridgeProvider } from '@avail-project/nexus-types';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import {
  type BridgeIntentDraft,
  type BridgeIntentToken,
  type ChainListType,
  logger,
  type TokenInfo,
  type Universe,
} from '../../domain';
import { Errors } from '../../domain/errors';
import { isNativeAddress } from '../../services/addresses';
import type { UserAssetsInstance } from '../../services/balances';
import { divDecimals, mulDecimals } from '../../services/math';
import { MAYAN_MIN_USD_PER_LEG, quoteMayanLegs } from '../../services/mayan';
import { equalFold } from '../../services/strings';
import type { MiddlewareBridgeClient, QuoteResponse } from '../../transport';
import { retrieveAddress } from '../context';

// Single-leg Mayan convergence: cap the swing-leg re-quotes and the per-step safety
// multiplier used to recover from an under-quote. Convergence is guaranteed because the
// swing leg at full usable already covers the residual, so these only bound the search for
// a smaller input that minimizes overshoot.
const MAYAN_SWING_MAX_QUOTES = 4;
const MAYAN_SWING_SAFETY = 1.02;

export type CreateIntentParams = {
  amount: Decimal;
  assets: UserAssetsInstance;
  gas: Decimal;
  gasInToken: Decimal;
  resolveUsdValue: (input: {
    amount: Decimal;
    chainId: number;
    tokenAddress: Hex;
    symbol?: string;
  }) => Decimal;
  sourceChains: number[];
  token: TokenInfo;
  provider: BridgeProvider;
  dstChainId: number;
  dstChainUniverse: Universe;
  dstChainNativeDecimals: number;
  recipient: `0x${string}`;
  quoteResponse: QuoteResponse;
};

export type CreateBridgeIntentContext = {
  chainList: ChainListType;
  evm: {
    address: Hex;
  };
  middlewareClient?: Pick<MiddlewareBridgeClient, 'getMayanQuotes'>;
};

export const lookupDepositFee = (
  chainId: number,
  tokenContract: Hex,
  quoteResponse: QuoteResponse,
  decimals: number,
  type: 'deposit' | 'depositMayan' = 'deposit'
): { amount: Decimal; raw: bigint } => {
  if (isNativeAddress(tokenContract)) return { amount: new Decimal(0), raw: 0n };
  const match = quoteResponse.sources.find(
    (s) => s.chainId === chainId && equalFold(s.tokenAddress, tokenContract)
  );
  if (!match) {
    throw Errors.internal(
      `Quote response missing deposit fee for chain ${chainId} token ${tokenContract}`
    );
  }
  return {
    amount: divDecimals(
      type === 'depositMayan' ? match.depositMayanFeeToken : match.depositFeeToken,
      decimals
    ),
    raw: BigInt(type === 'depositMayan' ? match.depositMayanFeeToken : match.depositFeeToken),
  };
};

const sortSourcesForFeeAllocation = <T extends { balance: Decimal; chain: { id: number } }>(
  sources: T[]
): T[] => {
  return [...sources].sort((a, b) => {
    const aIsEth = a.chain.id === 1 ? 1 : 0;
    const bIsEth = b.chain.id === 1 ? 1 : 0;
    if (aIsEth !== bIsEth) return aIsEth - bIsEth;
    return Decimal.sub(b.balance, a.balance).toNumber();
  });
};

const toBridgeIntentToken = (
  token: Pick<TokenInfo, 'contractAddress' | 'decimals' | 'logo' | 'name' | 'symbol'>
): BridgeIntentToken => ({
  contractAddress: token.contractAddress,
  decimals: token.decimals,
  logo: token.logo,
  name: token.name,
  symbol: token.symbol,
});

const toBridgeIntentChain = (chain: ReturnType<ChainListType['getChainByID']>) => ({
  id: chain.id,
  name: chain.name,
  logo: chain.custom.icon,
});

export const createBridgeIntent = async (
  input: CreateIntentParams,
  context: CreateBridgeIntentContext
): Promise<BridgeIntentDraft> => {
  if (input.provider === 'mayan') {
    return createMayanBridgeIntent(input, context);
  }

  const { amount, assets, gas, gasInToken, token } = input;
  const { chainList } = context;
  const evmAddress = context.evm.address;
  const destinationChain = chainList.getChainByID(input.dstChainId);
  const nativeToken = chainList.getNativeToken(input.dstChainId);

  const intent: BridgeIntentDraft = {
    provider: input.provider,
    availableSources: [],
    destination: {
      amount: new Decimal('0'),
      amountRaw: 0n,
      nativeAmount: gas,
      nativeAmountRaw: mulDecimals(gas, input.dstChainNativeDecimals),
      nativeAmountValue: new Decimal('0'),
      nativeAmountInToken: gasInToken,
      nativeToken: toBridgeIntentToken(nativeToken),
      chain: toBridgeIntentChain(destinationChain),
      token: toBridgeIntentToken(token),
      universe: input.dstChainUniverse,
      value: new Decimal('0'),
    },
    fees: {
      caGas: '0',
      deposit: '0',
      fulfillment: '0',
      protocol: '0',
      solver: '0',
    },
    selectedSources: [],
    recipientAddress: input.recipient,
  };

  const asset = assets.find({ currencyId: token.currencyId, symbol: token.symbol });
  if (!asset) {
    throw Errors.assetNotFound(token.symbol);
  }

  intent.availableSources = (await asset.iterate(chainList))
    .filter((entry) => entry.chain.id !== input.dstChainId)
    .map((entry) => {
      const sourceToken = chainList.getTokenByAddress(entry.chain.id, entry.contractAddress);
      const depositFee = lookupDepositFee(
        entry.chain.id,
        entry.contractAddress,
        input.quoteResponse,
        entry.decimals
      );
      return {
        amount: entry.balance,
        amountRaw: mulDecimals(entry.balance, entry.decimals),
        balance: entry.balance,
        chain: entry.chain,
        holderAddress: retrieveAddress(entry.universe, { evm: { address: evmAddress } }),
        depositFee: depositFee.amount,
        depositFeeRaw: depositFee.raw,
        token: toBridgeIntentToken({
          ...sourceToken,
          contractAddress: entry.contractAddress,
          decimals: entry.decimals,
        }),
        universe: entry.universe,
        value: entry.value,
      };
    })
    .map(({ balance: _balance, ...source }) => source);

  const requiredAmount = amount;
  const baseAmount = Decimal.add(requiredAmount, gasInToken);
  const fulfillmentFee = divDecimals(
    input.quoteResponse.destination.fulfillmentFeeToken,
    token.decimals
  );
  const fulfillmentBps = new Decimal(input.quoteResponse.fulfillmentBps);
  const bpsMultiplier = Decimal.add(1, Decimal.div(fulfillmentBps, 10_000));
  const payableAmount = Decimal.add(Decimal.mul(baseAmount, bpsMultiplier), fulfillmentFee);
  const allowedSources = sortSourcesForFeeAllocation(
    intent.availableSources
      .map((source) => ({ ...source, balance: source.amount }))
      .filter((source) => {
        if (input.sourceChains.length > 0 && !input.sourceChains.includes(source.chain.id)) {
          return false;
        }
        return true;
      })
  );

  if (allowedSources.length === 0) {
    throw Errors.invalidInput('intent must include at least one allowed source');
  }

  let remainingPayable = payableAmount;

  for (const source of allowedSources) {
    if (remainingPayable.lte(0)) break;

    if (source.depositFee.gte(source.balance)) {
      continue;
    }

    const usable = Decimal.sub(source.balance, source.depositFee);
    const used = Decimal.min(usable, remainingPayable);
    remainingPayable = Decimal.sub(remainingPayable, used);

    const totalDebited = Decimal.add(used, source.depositFee);
    const scaledValue = source.balance.gt(0)
      ? Decimal.mul(source.value, Decimal.div(totalDebited, source.balance))
      : new Decimal(0);

    intent.selectedSources.push({
      amount: used,
      amountRaw: mulDecimals(used, source.token.decimals),
      chain: source.chain,
      token: source.token,
      universe: source.universe,
      holderAddress: source.holderAddress,
      depositFee: source.depositFee,
      depositFeeRaw: source.depositFeeRaw,
      value: scaledValue,
    });
  }

  intent.destination.amount = requiredAmount;
  intent.destination.amountRaw = mulDecimals(requiredAmount, token.decimals);
  intent.destination.value = input.resolveUsdValue({
    amount: requiredAmount,
    chainId: input.dstChainId,
    tokenAddress: token.contractAddress,
    symbol: token.symbol,
  });

  if (remainingPayable.gt(0)) {
    const totalAvailable = Decimal.sub(payableAmount, remainingPayable);
    throw Errors.insufficientBalance(
      `required: ${payableAmount.toFixed()} ${token.symbol}, available: ${totalAvailable.toFixed()} ${token.symbol}`
    );
  }

  const totalDeposit = intent.selectedSources.reduce(
    (sum, source) => Decimal.add(sum, source.depositFee),
    new Decimal(0)
  );
  const protocolAmount = Decimal.mul(
    baseAmount,
    Decimal.div(input.quoteResponse.fulfillmentBps, 10_000)
  );

  intent.fees = {
    // caGas folds the per-source deposit fees + the destination fulfillment fee; protocol =
    // baseAmount × fulfillmentBps; solver is stubbed 0 (no separate solver fee on Nexus).
    caGas: Decimal.add(totalDeposit, fulfillmentFee).toFixed(),
    deposit: totalDeposit.toFixed(),
    fulfillment: fulfillmentFee.toFixed(),
    protocol: protocolAmount.toFixed(),
    solver: '0',
  };

  if (!gas.equals(0)) {
    intent.destination.nativeAmountValue = input.resolveUsdValue({
      amount: gas,
      chainId: input.dstChainId,
      tokenAddress: nativeToken.contractAddress,
      symbol: nativeToken.symbol,
    });
  }

  return intent;
};

const createMayanBridgeIntent = async (
  input: CreateIntentParams,
  context: CreateBridgeIntentContext
): Promise<BridgeIntentDraft> => {
  try {
    const { amount, assets, gas, gasInToken, token } = input;
    const { chainList } = context;
    const middlewareClient = context.middlewareClient;
    const evmAddress = context.evm.address;

    if (!middlewareClient) {
      throw Errors.internal('Mayan quote client unavailable during bridge intent creation');
    }

    const destinationChain = chainList.getChainByID(input.dstChainId);
    const nativeToken = chainList.getNativeToken(input.dstChainId);

    if (!destinationChain.mayanEnabled) {
      throw Errors.invalidInput(`Destination chain ${input.dstChainId} is disabled for Mayan`);
    }

    if (!token.mayanEnabled) {
      throw Errors.invalidInput(
        `Destination token ${token.contractAddress} is disabled for Mayan on chain ${input.dstChainId}`
      );
    }

    const intent: BridgeIntentDraft = {
      provider: input.provider,
      availableSources: [],
      destination: {
        amount: new Decimal('0'),
        amountRaw: 0n,
        nativeAmount: new Decimal(0),
        nativeAmountRaw: 0n,
        nativeAmountValue: new Decimal('0'),
        nativeAmountInToken: new Decimal(0),
        nativeToken: toBridgeIntentToken(nativeToken),
        chain: toBridgeIntentChain(destinationChain),
        token: toBridgeIntentToken(token),
        universe: input.dstChainUniverse,
        value: new Decimal('0'),
      },
      fees: {
        caGas: '0',
        deposit: '0',
        fulfillment: '0',
        protocol: '0',
        solver: '0',
      },
      selectedSources: [],
      recipientAddress: input.recipient,
    };

    const asset = assets.find({ currencyId: token.currencyId, symbol: token.symbol });
    if (!asset) {
      throw Errors.assetNotFound(token.symbol);
    }

    // Step 1: build the same source inventory as Nexus, including deposit fees, because
    // deposit fees still reduce how much of each balance is actually usable.
    intent.availableSources = (await asset.iterate(chainList))
      .filter((entry) => {
        if (entry.chain.id === input.dstChainId) {
          return false;
        }

        const sourceChain = chainList.getChainByID(entry.chain.id);
        if (!sourceChain.mayanEnabled) {
          return false;
        }

        const sourceToken = chainList.getTokenByAddress(entry.chain.id, entry.contractAddress);
        return sourceToken.mayanEnabled === true;
      })
      .map((entry) => {
        const sourceToken = chainList.getTokenByAddress(entry.chain.id, entry.contractAddress);
        const depositFee = lookupDepositFee(
          entry.chain.id,
          entry.contractAddress,
          input.quoteResponse,
          entry.decimals,
          'depositMayan'
        );
        return {
          amount: entry.balance,
          amountRaw: mulDecimals(entry.balance, entry.decimals),
          balance: entry.balance,
          chain: entry.chain,
          holderAddress: retrieveAddress(entry.universe, { evm: { address: evmAddress } }),
          depositFee: depositFee.amount,
          depositFeeRaw: depositFee.raw,
          token: toBridgeIntentToken({
            ...sourceToken,
            contractAddress: entry.contractAddress,
            decimals: entry.decimals,
          }),
          universe: entry.universe,
          value: entry.value,
        };
      })
      .map(({ balance: _balance, ...source }) => source);

    // Step 2: keep only sources that can satisfy Mayan's per-leg minimum after
    // deposit fee is deducted from the source balance.
    const minimumPerLegUsd = new Decimal(MAYAN_MIN_USD_PER_LEG);
    const allowedSources = intent.availableSources
      .map((source) => {
        const usable = Decimal.sub(source.amount, source.depositFee);
        const usdPerToken = input.resolveUsdValue({
          amount: new Decimal(1),
          chainId: source.chain.id,
          tokenAddress: source.token.contractAddress,
          symbol: source.token.symbol,
        });

        return {
          ...source,
          balance: source.amount,
          minimumAmount: usdPerToken.gt(0)
            ? Decimal.mul(
                Decimal.div(minimumPerLegUsd, usdPerToken),
                // For native ETH bridged to Ethereum mainnet, require a higher per-leg minimum.
                input.dstChainId === 1 && isNativeAddress(token.contractAddress) ? 2 : 1
              )
            : new Decimal(Number.POSITIVE_INFINITY),
          usable,
          usableUsd: Decimal.mul(usable, usdPerToken),
        };
      })
      .filter((source) => {
        if (input.sourceChains.length > 0 && !input.sourceChains.includes(source.chain.id)) {
          return false;
        }
        return source.usableUsd.gte(minimumPerLegUsd) && source.usable.gte(source.minimumAmount);
      })
      .sort((a, b) => Decimal.sub(b.usableUsd, a.usableUsd).toNumber());
    if (allowedSources.length === 0) {
      throw Errors.invalidInput('intent must include at least one allowed source');
    }

    // Step 3: Mayan quotes are exact-in while the SDK bridge request is exact-out. We quote
    // every eligible leg once at its full usable amount, commit the largest legs in full,
    // and trim only the last (swing) leg to the residual output we still need. The swing leg
    // may overshoot by up to one per-leg minimum, which is accepted.
    let finalAmountOut = new Decimal(0);

    // From Mayan docs: https://docs.mayan.finance/application/gas-on-destination
    const mayanMaxGasDropByChainId: Record<number, number> = {
      1: 0.05,
      56: 0.02,
      137: 0.2,
      43114: 0.1,
      42161: 0.01,
    };
    const gasDrop = gas.lte(0)
      ? 0
      : Math.min(Number(gas.toString()), mayanMaxGasDropByChainId[input.dstChainId] ?? 0);
    const gasDropAmount = new Decimal(gasDrop.toString());
    const isNativeDestination = isNativeAddress(token.contractAddress);
    if (isNativeDestination && gasDropAmount.gt(0)) {
      throw Errors.invalidInput(
        'Mayan gas drop is not supported when the destination token is native; include it in the destination amount instead'
      );
    }
    // Scale the token-side gas cost down when Mayan caps the requested gas drop.
    const gasDropInToken =
      gas.lte(0) || gasDropAmount.lte(0)
        ? new Decimal(0)
        : Decimal.mul(gasInToken, Decimal.div(gasDropAmount, gas));

    intent.destination.nativeAmount = gasDropAmount;
    intent.destination.nativeAmountRaw = mulDecimals(
      intent.destination.nativeAmount,
      input.dstChainNativeDecimals
    );
    intent.destination.nativeAmountInToken = gasDropInToken;

    const mayanDestination = {
      chainId: input.dstChainId,
      tokenAddress: token.contractAddress,
    };

    // Single-leg quote helper, used to trim the swing leg during convergence.
    const requestLegQuote = async (
      source: (typeof allowedSources)[number],
      legInput: Decimal,
      withGasDrop: boolean
    ) => {
      const [leg] = await quoteMayanLegs(middlewareClient, {
        legs: [
          {
            chainId: source.chain.id,
            tokenAddress: source.token.contractAddress,
            amountRaw: mulDecimals(legInput, source.token.decimals),
            gasDrop: withGasDrop ? gasDrop : undefined,
          },
        ],
        destination: mayanDestination,
      });
      return { source, input: legInput, quote: leg.quote, out: leg.minReceived };
    };

    // Step 4: quote every eligible leg once at its full usable amount. The destination gas
    // drop rides the largest leg (index 0 after the usableUsd-desc sort) so a single quote
    // pays for it.
    const maxQuotes = await quoteMayanLegs(middlewareClient, {
      legs: allowedSources.map((source, index) => ({
        chainId: source.chain.id,
        tokenAddress: source.token.contractAddress,
        amountRaw: mulDecimals(source.usable, source.token.decimals),
        gasDrop: gasDrop > 0 && index === 0 ? gasDrop : undefined,
      })),
      destination: mayanDestination,
    });
    const maxLegs = allowedSources.map((source, index) => ({
      source,
      input: source.usable,
      quote: maxQuotes[index].quote,
      out: maxQuotes[index].minReceived,
    }));

    // Step 5: commit the largest legs in full until their summed output covers the
    // requested amount.
    const committedLegs: typeof maxLegs = [];
    let cumulativeOut = new Decimal(0);
    for (const leg of maxLegs) {
      committedLegs.push(leg);
      cumulativeOut = Decimal.add(cumulativeOut, leg.out);
      if (cumulativeOut.gte(amount)) {
        break;
      }
    }
    if (cumulativeOut.lt(amount)) {
      throw Errors.insufficientBalance(
        `required: ${amount.toFixed()} ${token.symbol}, available: ${cumulativeOut.toFixed()} ${token.symbol}`
      );
    }

    // Step 6: trim only the last committed leg (the swing) down to the residual output we
    // still need. At full usable it already produces at least that residual (it tipped the
    // running sum over the target), so a smaller input that still covers it is guaranteed to
    // exist; worst case the leg stays at full usable. The swing may overshoot by up to one
    // per-leg minimum, which is accepted.
    const swingIndex = committedLegs.length - 1;
    const swingMaxLeg = committedLegs[swingIndex];
    const fixedOut = committedLegs
      .slice(0, swingIndex)
      .reduce((sum, leg) => Decimal.add(sum, leg.out), new Decimal(0));
    const needFromSwing = Decimal.sub(amount, fixedOut);
    const swingSource = swingMaxLeg.source;
    const swingWithGasDrop = gasDrop > 0 && swingIndex === 0;

    let swingLeg = swingMaxLeg;
    if (needFromSwing.lt(swingMaxLeg.out)) {
      // Seed the trim from the leg's absolute haircut (input − out at full usable), not by dividing
      // by the best (full-size) rate. Mayan's cost is mostly a FIXED relayer/gas charge, so to net
      // `needFromSwing` you must send in ≈ need + that fee; dividing by the best rate undershoots on a
      // smaller leg (a worse effective rate) and forces the bump loop — which on a thin source leaps
      // to `usable` and over-delivers. The bump loop below stays as the safety net.
      // ponytail: models the fee as fixed (absolute); if real small-leg rates run much worse than
      // full-size this can still undershoot → bump. Upgrade path: binary-search [trial, usable] so
      // overshoot is capped regardless of the fee curve — revisit if live quotes show it.
      const fullHaircut = swingMaxLeg.input.minus(swingMaxLeg.out);
      let trialInput = Decimal.min(
        Decimal.max(needFromSwing.plus(fullHaircut), swingSource.minimumAmount),
        swingSource.usable
      );
      for (
        let attempt = 0;
        attempt < MAYAN_SWING_MAX_QUOTES && trialInput.lt(swingSource.usable);
        attempt++
      ) {
        const quoted = await requestLegQuote(swingSource, trialInput, swingWithGasDrop);
        if (quoted.out.gte(needFromSwing)) {
          swingLeg = quoted;
          break;
        }
        // Under-quote: re-estimate off the observed (worse) rate, force progress, cap at usable.
        const observedRate = quoted.out.div(trialInput);
        trialInput = Decimal.min(
          Decimal.max(
            needFromSwing.div(observedRate).mul(MAYAN_SWING_SAFETY),
            trialInput.mul(MAYAN_SWING_SAFETY)
          ),
          swingSource.usable
        );
      }
    }
    committedLegs[swingIndex] = swingLeg;

    // Step 7: materialize the selected sources from the committed legs.
    intent.selectedSources = committedLegs.map((leg) => {
      const totalDebited = Decimal.add(leg.input, leg.source.depositFee);
      const scaledValue = leg.source.balance.gt(0)
        ? Decimal.mul(leg.source.value, Decimal.div(totalDebited, leg.source.balance))
        : new Decimal(0);
      return {
        amount: leg.input,
        amountRaw: mulDecimals(leg.input, leg.source.token.decimals),
        chain: leg.source.chain,
        token: leg.source.token,
        universe: leg.source.universe,
        holderAddress: leg.source.holderAddress,
        depositFee: leg.source.depositFee,
        depositFeeRaw: leg.source.depositFeeRaw,
        value: scaledValue,
        mayanQuote: leg.quote,
      };
    });

    finalAmountOut = committedLegs.reduce((sum, leg) => Decimal.add(sum, leg.out), new Decimal(0));

    logger.debug('createMayanBridgeIntent:converged', {
      gasDrop,
      committed: committedLegs.length,
      finalAmountOut: finalAmountOut.toFixed(),
    });

    // Step 6: once the quotes have converged, set the destination amount to the converged Mayan
    // output (Σ minReceived across legs), then derive the Mayan fee split from the final quotes.
    intent.destination.amount = finalAmountOut;
    intent.destination.amountRaw = mulDecimals(finalAmountOut, token.decimals);
    intent.destination.value = input.resolveUsdValue({
      amount: finalAmountOut,
      chainId: input.dstChainId,
      tokenAddress: token.contractAddress,
      symbol: token.symbol,
    });

    const totalDeposit = intent.selectedSources.reduce(
      (sum, source) => Decimal.add(sum, source.depositFee),
      new Decimal(0)
    );
    const totalAmountIn = intent.selectedSources.reduce(
      (sum, source) => Decimal.add(sum, source.amount),
      new Decimal(0)
    );
    const totalAmountOut = intent.selectedSources.reduce((sum, source) => {
      if (!source.mayanQuote) {
        throw Errors.internal('Mayan quote missing from selected source');
      }
      return Decimal.add(sum, new Decimal(source.mayanQuote.minReceived.toString()));
    }, new Decimal(0));
    const protocolAmount = intent.selectedSources.reduce((sum, source) => {
      if (!source.mayanQuote) {
        throw Errors.internal('Mayan quote missing from selected source');
      }
      return Decimal.add(
        sum,
        Decimal.mul(source.amount, Decimal.div(source.mayanQuote.protocolBps ?? 3, 10_000))
      );
    }, new Decimal(0));
    const fulfillmentAmount = Decimal.sub(totalAmountIn, totalAmountOut);
    const solverAmount = Decimal.sub(fulfillmentAmount, protocolAmount);

    intent.fees = {
      caGas: '0',
      deposit: totalDeposit.toFixed(),
      fulfillment: fulfillmentAmount.toFixed(),
      protocol: protocolAmount.toFixed(),
      solver: solverAmount.toFixed(),
    };

    if (intent.destination.nativeAmount.gt(0)) {
      intent.destination.nativeAmountValue = input.resolveUsdValue({
        amount: intent.destination.nativeAmount,
        chainId: input.dstChainId,
        tokenAddress: nativeToken.contractAddress,
        symbol: nativeToken.symbol,
      });
    }

    logger.debug('createMayanBridgeIntent:final', {
      finalAmountOut: finalAmountOut.toFixed(),
      gasDrop,
      fees: intent.fees,
    });

    return intent;
  } catch (mayanError) {
    logger.warn('createMayanBridgeIntent:fallbackToNexus', {
      error: mayanError instanceof Error ? mayanError.message : String(mayanError),
    });

    try {
      return await createBridgeIntent({ ...input, provider: 'nexus' }, context);
    } catch (nexusError) {
      const mayanMessage = mayanError instanceof Error ? mayanError.message : String(mayanError);
      const nexusMessage = nexusError instanceof Error ? nexusError.message : String(nexusError);

      throw Errors.internal(
        `Mayan failed: ${mayanMessage}. Nexus fallback failed: ${nexusMessage}`
      );
    }
  }
};
