import Decimal from 'decimal.js';
import { decodeFunctionData, type Hex, parseAbi, toHex, zeroAddress } from 'viem';
import { ZERO_ADDRESS } from '../../domain/constants/addresses';
import { isNativeAddress } from '../../services/addresses';
import { divDecimals } from '../../services/math';
import { SLIPPAGE_BPS_STRING } from './constants';
import type { Aggregator, Quote, QuoteRequest } from './types';
import { QuoteType } from './types';
import { normalizeExpectedOutput } from './expected-output';

const ERC20_APPROVE_ABI = parseAbi(['function approve(address spender, uint256 value)']);

// Relay `/quote/v2` used as a SAME-CHAIN swap: originChainId == destinationChainId. Native is the
// ZERO address on Relay (its default currency), whereas the SDK hands adapters EADDRESS — so map
// native → zero on the request and keep the SDK-canonical token on the returned quote.
const relayCurrency = (token: Hex): Hex => (isNativeAddress(token) ? ZERO_ADDRESS : token);

// Chains Relay serves — LiFi's list minus Kaia (8217). Confirm/expand against
// https://docs.relay.link/resources/supported-chains. Unlike the other adapters there is
// deliberately NO local gate in fetchQuote: Relay is the probe for the zero-supporter
// selection fallback, so a chain missing from every static list still reaches a live endpoint.
const SUPPORTED_CHAINS = new Set<number>([
  1, // Ethereum
  10, // Optimism
  56, // BSC
  137, // Polygon
  143, // Monad
  999, // HyperEVM
  4326, // MegaETH
  8453, // Base
  42161, // Arbitrum
  43114, // Avalanche
  534352, // Scroll
]);

export class RelayAggregator implements Aggregator {
  private readonly getQuote: (params: Record<string, string>) => Promise<unknown>;

  constructor(getQuote: (params: Record<string, string>) => Promise<unknown>) {
    this.getQuote = getQuote;
  }

  supportsChain(chainId: number): boolean {
    return SUPPORTED_CHAINS.has(chainId);
  }

  async getQuotes(requests: QuoteRequest[]): Promise<(Quote | null)[]> {
    return Promise.all(requests.map((req) => this.fetchQuote(req)));
  }

  private async fetchQuote(req: QuoteRequest): Promise<Quote | null> {
    try {
      const isExactOut = req.type === QuoteType.EXACT_OUT;
      const chainId = req.chainId.toString();
      const amountRaw =
        isExactOut && 'outputAmount' in req
          ? req.outputAmount
          : 'inputAmount' in req
            ? req.inputAmount
            : 0n;

      const params: Record<string, string> = {
        user: req.userAddress,
        recipient: req.recipientAddress,
        originChainId: chainId,
        destinationChainId: chainId, // same-chain swap
        originCurrency: relayCurrency(req.inputToken),
        destinationCurrency: relayCurrency(req.outputToken),
        amount: amountRaw.toString(),
        tradeType: isExactOut ? 'EXACT_OUTPUT' : 'EXACT_INPUT',
        slippageTolerance: SLIPPAGE_BPS_STRING,
      };

      const data = (await this.getQuote(params)) as RelayResponse;
      return parseResponse(data, req, isExactOut);
    } catch {
      return null;
    }
  }
}

const parseResponse = (
  data: RelayResponse,
  req: QuoteRequest,
  isExactOut: boolean
): Quote | null => {
  // Same-chain swaps return an `approve` step (ERC-20) then a `swap` step. The SDK runs its own
  // approval, so we only read the `swap` transaction and the approve step's spender — the signature
  // (Permit2 / EIP-3009 authorize*) steps are irrelevant here.
  const tx = data.steps?.find((s) => s.id === 'swap' && s.kind === 'transaction')?.items?.[0]?.data;
  if (!tx?.to) return null;

  const currencyIn = data.details?.currencyIn;
  const currencyOut = data.details?.currencyOut;
  if (!currencyIn || !currencyOut) return null;

  // EXACT_IN floors the output at the slippage-protected `minimumAmount`; EXACT_OUT delivers the
  // exact requested output. The input is Relay's quoted `amount` either way.
  const inputAmountRaw = BigInt(currencyIn.amount);
  const outputAmountRaw = BigInt(isExactOut ? currencyOut.amount : currencyOut.minimumAmount);

  const output = buildSide(currencyOut, req.outputToken, outputAmountRaw);
  return {
    input: buildSide(currencyIn, req.inputToken, inputAmountRaw),
    output,
    expectedOutput: normalizeExpectedOutput(currencyOut.amount, output),
    txData: {
      approvalAddress: resolveApprovalAddress(data, req.inputToken, tx.to as Hex),
      tx: {
        to: tx.to as Hex,
        data: tx.data as Hex,
        value: tx.value ? toHex(BigInt(tx.value)) : '0x0',
      },
    },
  };
};

// Native needs no approval. Otherwise use the spender Relay's `approve` step encodes (the step's `to`
// is the token; the spender lives in its `approve(spender,value)` calldata), falling back to the swap
// contract when there is no approve step or the calldata can't be decoded.
const resolveApprovalAddress = (data: RelayResponse, inputToken: Hex, swapTo: Hex): Hex => {
  if (isNativeAddress(inputToken)) return zeroAddress;
  const approveData = data.steps?.find((s) => s.id === 'approve')?.items?.[0]?.data?.data;
  if (approveData) {
    try {
      const { args } = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: approveData as Hex });
      return args[0] as Hex;
    } catch {
      // fall through to the swap contract
    }
  }
  return swapTo;
};

// Relay reports amountUsd for the whole leg; derive a per-token priceUsd so `value` tracks the
// slippage-protected amount (parity with the LiFi adapter's value = amount × priceUsd).
const buildSide = (
  detail: RelayCurrencyDetail,
  tokenAddress: Hex,
  amountRaw: bigint
): Quote['input'] => {
  const { currency } = detail;
  const amount = divDecimals(amountRaw, currency.decimals).toFixed();
  const formatted = new Decimal(detail.amountFormatted);
  const priceUsd = formatted.gt(0) ? new Decimal(detail.amountUsd).div(formatted).toNumber() : 0;
  return {
    contractAddress: tokenAddress, // SDK-canonical token (EADDRESS for native), not Relay's zero
    amount,
    amountRaw,
    decimals: currency.decimals,
    value: new Decimal(amount).mul(priceUsd).toNumber(),
    priceUsd,
    symbol: currency.symbol,
  };
};

// ---------------------------------------------------------------------------
// Relay response types (internal — only the fields the adapter reads)
// ---------------------------------------------------------------------------

type RelayTxData = { to?: string; data?: string; value?: string };
type RelayStep = { id: string; kind: string; items?: { data?: RelayTxData }[] };
type RelayCurrencyDetail = {
  currency: { address: string; symbol: string; decimals: number };
  amount: string;
  amountFormatted: string;
  amountUsd: string;
  minimumAmount: string;
};
type RelayResponse = {
  steps?: RelayStep[];
  details?: { currencyIn?: RelayCurrencyDetail; currencyOut?: RelayCurrencyDetail };
};
