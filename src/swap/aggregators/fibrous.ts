import Decimal from 'decimal.js';
import { encodeFunctionData, getAddress, type Hex, toHex, zeroAddress } from 'viem';
import type { Aggregator, Quote, QuoteRequest } from './types';
import { QuoteType } from './types';

const CHAIN_NAME_MAP: Record<number, string> = {
  // 999: 'hyperevm', // Causing issue
  // 143: 'monad',    // Just in case
  4114: 'citrea',
};

const DEFAULT_EXCLUDE_PROTOCOLS = '3';
const DEFAULT_SLIPPAGE = '0.5';

export type FibrousAggregatorOptions = {
  excludeProtocols?: string;
};

export class FibrousAggregator implements Aggregator {
  private readonly getQuote: (params: Record<string, string>) => Promise<unknown>;
  private readonly excludeProtocols: string;

  constructor(
    getQuote: (params: Record<string, string>) => Promise<unknown>,
    options: FibrousAggregatorOptions = {}
  ) {
    this.getQuote = getQuote;
    this.excludeProtocols = options.excludeProtocols ?? DEFAULT_EXCLUDE_PROTOCOLS;
  }

  async getQuotes(requests: QuoteRequest[]): Promise<(Quote | null)[]> {
    return Promise.all(requests.map((req) => this.fetchQuote(req)));
  }

  private async fetchQuote(req: QuoteRequest): Promise<Quote | null> {
    if (req.type === QuoteType.EXACT_OUT) return null;
    const chainName = CHAIN_NAME_MAP[req.chainId];
    if (!chainName) return null;

    try {
      const params: Record<string, string> = {
        chain: chainName,
        amount: req.inputAmount.toString(),
        tokenInAddress: req.inputToken,
        tokenOutAddress: req.outputToken,
        slippage: DEFAULT_SLIPPAGE,
        destination: req.recipientAddress,
        excludeProtocols: this.excludeProtocols,
      };

      const data = await this.getQuote(params);
      return this.parseResponse(data as FibrousResponse, req);
    } catch {
      return null;
    }
  }

  private parseResponse(data: FibrousResponse, req: QuoteRequest): Quote | null {
    if (!data.route.success) return null;
    if (data.calldata.swap_parameters.length === 0) return null;

    const inputDecimals = data.route.inputToken.decimals;
    const outputDecimals = data.route.outputToken.decimals;

    const inputAmountRaw = BigInt(data.route.inputAmount);
    const outputAmountRaw = BigInt(data.calldata.route.min_received);

    const inputAmount = new Decimal(data.route.inputAmount)
      .div(Decimal.pow(10, inputDecimals))
      .toFixed(inputDecimals);
    const outputAmount = new Decimal(data.calldata.route.min_received)
      .div(Decimal.pow(10, outputDecimals))
      .toFixed(outputDecimals);

    const routerAddress = getAddress(data.router_address);
    const isNativeInput = data.calldata.route.swap_type === 0;

    return {
      input: {
        contractAddress: req.inputToken,
        amount: inputAmount,
        amountRaw: inputAmountRaw,
        decimals: inputDecimals,
        value: Decimal.mul(inputAmount, data.route.inputToken.price ?? 0).toNumber(),
        symbol: data.route.inputToken.symbol ?? data.route.inputToken.name,
      },
      output: {
        contractAddress: req.outputToken,
        amount: outputAmount,
        amountRaw: outputAmountRaw,
        decimals: outputDecimals,
        value: Decimal.mul(outputAmount, data.route.outputToken.price ?? 0).toNumber(),
        symbol: data.route.outputToken.symbol ?? data.route.outputToken.name,
      },
      txData: {
        approvalAddress: isNativeInput ? zeroAddress : routerAddress,
        tx: {
          to: routerAddress,
          value: isNativeInput ? toHex(BigInt(data.calldata.route.amount_in)) : toHex(0),
          data: encodeFunctionData({
            abi: FibrousRouterABI,
            functionName: 'swap',
            args: [
              {
                token_in: getAddress(data.calldata.route.token_in),
                token_out: getAddress(data.calldata.route.token_out),
                amount_in: BigInt(data.calldata.route.amount_in),
                amount_out: BigInt(data.calldata.route.amount_out),
                min_received: BigInt(data.calldata.route.min_received),
                destination: getAddress(data.calldata.route.destination),
                swap_type: data.calldata.route.swap_type,
              },
              data.calldata.swap_parameters.map((p) => ({
                token_in: getAddress(p.token_in),
                token_out: getAddress(p.token_out),
                rate: Number.parseInt(p.rate, 10),
                protocol_id: Number.parseInt(p.protocol_id, 10),
                pool_address: getAddress(p.pool_address),
                swap_type: p.swap_type,
                extra_data: p.extra_data,
              })),
            ],
          }),
        },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Fibrous response types (internal)
// ---------------------------------------------------------------------------

type FibrousToken = {
  name: string;
  symbol?: string;
  address: Hex;
  decimals: number;
  price: number | string | null;
};

type FibrousResponse = {
  route: {
    success: boolean;
    routeSwapType: number;
    inputToken: FibrousToken;
    inputAmount: string;
    outputToken: FibrousToken;
    outputAmount: string;
  };
  calldata: {
    route: {
      token_in: Hex;
      token_out: Hex;
      amount_in: string;
      amount_out: string;
      min_received: string;
      destination: Hex;
      swap_type: number;
    };
    swap_parameters: Array<{
      token_in: Hex;
      token_out: Hex;
      rate: string;
      protocol_id: string;
      pool_address: Hex;
      swap_type: number;
      extra_data: Hex;
    }>;
  };
  router_address: Hex;
};

// ---------------------------------------------------------------------------
// FibrousRouter ABI (only the `swap` function is used)
// ---------------------------------------------------------------------------

const FibrousRouterABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'token_in', type: 'address' },
          { internalType: 'address', name: 'token_out', type: 'address' },
          { internalType: 'uint256', name: 'amount_in', type: 'uint256' },
          { internalType: 'uint256', name: 'amount_out', type: 'uint256' },
          { internalType: 'uint256', name: 'min_received', type: 'uint256' },
          { internalType: 'address', name: 'destination', type: 'address' },
          { internalType: 'uint8', name: 'swap_type', type: 'uint8' },
        ],
        internalType: 'struct IFibrousRouter.RouteParam',
        name: 'route',
        type: 'tuple',
      },
      {
        components: [
          { internalType: 'address', name: 'token_in', type: 'address' },
          { internalType: 'address', name: 'token_out', type: 'address' },
          { internalType: 'uint32', name: 'rate', type: 'uint32' },
          { internalType: 'int24', name: 'protocol_id', type: 'int24' },
          { internalType: 'address', name: 'pool_address', type: 'address' },
          { internalType: 'uint8', name: 'swap_type', type: 'uint8' },
          { internalType: 'bytes', name: 'extra_data', type: 'bytes' },
        ],
        internalType: 'struct IFibrousRouter.SwapParams[]',
        name: 'swap_parameters',
        type: 'tuple[]',
      },
    ],
    name: 'swap',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;
