// High-fidelity swap characterization harness.
//
// Goal: drive the REAL swap() flow and assert every emitted on-chain call (source-swap,
// bridge/COT deposit, prefunding, destination-swap) by decoding calldata, call-by-call.
// We mock ONLY injected deps: the aggregator quotes (echoed into real SWAP calldata so the
// taker/receiver/amount survive into the batch and can be decoded back out), the middleware
// client (capture what we send), public-client reads, and the network send.
//
// Wallets are REAL viem accounts (fixed private keys). The EOA wrapper does real RLP encoding +
// secp256k1 signing for sendTransaction/writeContract and captures the signed raw tx; only the
// network broadcast is faked. The ephemeral is a real PrivateKeyAccount, so SBC / permit / Safe /
// intent signatures are genuine.

import {
  type Abi,
  type Chain,
  type Hex,
  type WalletClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  keccak256,
  parseTransaction,
  parseUnits,
  recoverTransactionAddress,
  size,
  slice,
  toHex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { expect, vi } from 'vitest';
import Decimal from 'decimal.js';
import { EVMVaultABI } from '../../src/abi/vault';
import { ERC20PermitABI } from '../../src/abi/erc20';
import { VAULT_ABI_MAYAN } from '@avail-project/nexus-types/rff';
import { SWEEPER_ABI } from '../../src/swap/sweep';
import { CALIBUR_EXECUTE_ABI } from '../../src/services/sbc';
import { multiSendCallOnlyAbi } from '../../src/swap/safe/abis';
import { predictSafeAccountAddress } from '../../src/swap/safe/predict';
import { EADDRESS } from '../../src/swap/constants';
import { isNativeAddress } from '../../src/services/addresses';
import type { CreateSafeExecuteTxRequest } from '../../src/swap/safe/types';
import type { SBCTx } from '../../src/swap/types';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  USDC_ARB,
  USDC_BASE,
  USDC_OP,
  WETH,
} from './swap';

// Real token address. helpers/swap.ts exports DAI as a non-hex placeholder ('0xDAI...') which
// getAddress() rejects in the aggregators, so we use the real DAI (Arbitrum/Optimism deployment).
export const SOURCE_DAI = '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1' as Hex;

/* ────────────────────────────────────────────────────────────────────────────
 * Real accounts (fixed keys → deterministic addresses + Safe prediction)
 * Anvil default keys [0] and [1].
 * ──────────────────────────────────────────────────────────────────────────── */
export const EOA_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
export const EPH_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;

export const EOA_ACCOUNT = privateKeyToAccount(EOA_PRIVATE_KEY);
export const EPH_ACCOUNT = privateKeyToAccount(EPH_PRIVATE_KEY);
export const EOA = EOA_ACCOUNT.address;
export const EPH = EPH_ACCOUNT.address;
export const PREDICTED_SAFE = predictSafeAccountAddress(EPH).address as Hex;

/* ────────────────────────────────────────────────────────────────────────────
 * Custom SWAP ABI — the echo. The mock aggregator encodes the request's
 * taker/receiver/amount into this call; parseQuote passes txData.tx.data through
 * verbatim, so we decode it back out of the SBC/Safe batch and assert exact args.
 * ──────────────────────────────────────────────────────────────────────────── */
export const MOCK_SWAP_ABI = [
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'payable',
    inputs: [
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputAmount', type: 'uint256' },
      { name: 'taker', type: 'address' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
  },
] as const;

const DAI_PERMIT_ABI = [
  {
    type: 'function',
    name: 'permit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'holder', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'allowed', type: 'bool' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

// Real aggregator addresses (same deployment across our chains), so decoded swap `to`/approval
// targets read as the actual routers. PERMIT2 is the canonical Uniswap Permit2 Bebop approves.
// lowercase so viem getAddress() re-checksums cleanly (mixed-case with a bad checksum throws).
export const LIFI_DIAMOND = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae' as Hex;
export const BEBOP_SETTLEMENT = '0xbeb09000fa59627dc02bb55448ac1893eaa501a5' as Hex;
export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3' as Hex;
export const ROUTERS = { lifi: LIFI_DIAMOND, bebop: BEBOP_SETTLEMENT };
export const APPROVALS = { lifi: LIFI_DIAMOND, bebop: PERMIT2 };

// Nexus settlement vault per chain. Real per-chain vault addresses come from the middleware
// deployment (not shipped in-repo); these stand in as the per-chain settlement targets.
export const VAULT_BY_CHAIN: Record<number, Hex> = {
  [ARB_CHAIN]: '0x4444444444444444444444444444444444440001',
  [OP_CHAIN]: '0x4444444444444444444444444444444444440002',
  [BASE_CHAIN]: '0x4444444444444444444444444444444444440003',
};

/* ────────────────────────────────────────────────────────────────────────────
 * Token metadata + deterministic rates (drive routing math)
 * ──────────────────────────────────────────────────────────────────────────── */
type TokenMeta = { symbol: string; decimals: number; name: string };

const TOKEN_META: Record<string, TokenMeta> = {
  [USDC_ARB.toLowerCase()]: { symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  [USDC_OP.toLowerCase()]: { symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  [USDC_BASE.toLowerCase()]: { symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  [WETH.toLowerCase()]: { symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
  [SOURCE_DAI.toLowerCase()]: { symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' },
  [EADDRESS.toLowerCase()]: { symbol: 'ETH', decimals: 18, name: 'Ether' },
};

export const tokenMeta = (address: Hex): TokenMeta => {
  if (isNativeAddress(address)) return { symbol: 'ETH', decimals: 18, name: 'Ether' };
  const meta = TOKEN_META[address.toLowerCase()];
  if (!meta) throw new Error(`Unknown token ${address}`);
  return meta;
};

// human output per 1 input, per aggregator. Bebop is strictly better on every pair we use,
// so auto-select (maximize output) deterministically picks Bebop → predictable routers.
// Symmetric pairs auto-inverted; stable→stable = 1.
type Agg = 'lifi' | 'bebop';
const RATES: Record<Agg, Record<string, Decimal>> = {
  // Explicit both-direction entries (not inverse-derived) so Bebop is strictly better each way and
  // deterministically wins — inverse-deriving ETH>USDC from USDC>ETH would otherwise flip the winner.
  bebop: {
    'DAI>USDC': new Decimal('1'),
    'USDC>WETH': new Decimal('0.0004'), // 2500 USDC / ETH
    'WETH>USDC': new Decimal('2500'),
    'USDC>ETH': new Decimal('0.0004'),
    'ETH>USDC': new Decimal('2500'),
  },
  lifi: {
    'DAI>USDC': new Decimal('0.98'),
    'USDC>WETH': new Decimal('0.00039'),
    'WETH>USDC': new Decimal('2450'),
    'USDC>ETH': new Decimal('0.00039'),
    'ETH>USDC': new Decimal('2450'),
  },
};

// Register a token the chainList (deployment) has never heard of but the aggregators support —
// the "unknown destination token" cells. Adds echo metadata (also served as on-chain erc20 reads
// by readContractStub) + USDC rates (bebop strictly better, so it deterministically wins).
export const registerAggregatorOnlyToken = (
  address: Hex,
  meta: { symbol: string; decimals: number; name: string },
  usdcRate: number
) => {
  TOKEN_META[address.toLowerCase()] = meta;
  RATES.bebop[`USDC>${meta.symbol}`] = new Decimal(usdcRate);
  RATES.lifi[`USDC>${meta.symbol}`] = new Decimal(usdcRate).mul(0.98);
};

const rate = (agg: Agg, inputToken: Hex, outputToken: Hex): Decimal => {
  const a = tokenMeta(inputToken).symbol;
  const b = tokenMeta(outputToken).symbol;
  if (a === b) return new Decimal('1');
  const table = RATES[agg];
  const direct = table[`${a}>${b}`];
  if (direct) return direct;
  const inverse = table[`${b}>${a}`];
  if (inverse) return new Decimal('1').div(inverse);
  throw new Error(`No ${agg} rate for ${a}>${b}`);
};

const toRaw = (human: Decimal, decimals: number) => parseUnits(human.toFixed(decimals), decimals);
const fromRaw = (raw: bigint, decimals: number) => new Decimal(formatUnits(raw, decimals));

/* ────────────────────────────────────────────────────────────────────────────
 * Echo aggregator responders (LiFi + Bebop shapes that lifi.ts/bebop.ts transform)
 * ──────────────────────────────────────────────────────────────────────────── */
const encodeEchoSwap = (
  inputToken: Hex,
  outputToken: Hex,
  inputRaw: bigint,
  outputRaw: bigint,
  taker: Hex,
  receiver: Hex
): Hex =>
  encodeFunctionData({
    abi: MOCK_SWAP_ABI,
    functionName: 'swap',
    args: [inputToken, outputToken, inputRaw, outputRaw, taker, receiver],
  });

const isNative = (addr: Hex) => addr.toLowerCase() === EADDRESS.toLowerCase();
// Native-input swaps carry the input as tx.value (the aggregator pulls native via msg.value).
const nativeValueHex = (inputToken: Hex, inputRaw: bigint): Hex =>
  isNative(inputToken) ? toHex(inputRaw) : ('0x0' as Hex);

export const makeLiFiResponse = (
  params: Record<string, string>,
  exactOut = false,
  rateMul?: (inputToken: Hex, outputToken: Hex) => number
) => {
  const inputToken = params.fromToken as Hex;
  const outputToken = params.toToken as Hex;
  const inDec = tokenMeta(inputToken).decimals;
  const outDec = tokenMeta(outputToken).decimals;
  const r = rate('lifi', inputToken, outputToken).mul(rateMul?.(inputToken, outputToken) ?? 1);

  const outputHuman = exactOut
    ? fromRaw(BigInt(params.toAmount), outDec)
    : fromRaw(BigInt(params.fromAmount), inDec).mul(r);
  const inputHuman = exactOut ? outputHuman.div(r) : fromRaw(BigInt(params.fromAmount), inDec);
  const inputRaw = toRaw(inputHuman, inDec);
  const outputRaw = toRaw(outputHuman, outDec);

  return {
    estimate: {
      fromAmount: inputRaw.toString(),
      fromAmountUSD: inputHuman.toFixed(2),
      toAmount: outputRaw.toString(),
      toAmountMin: outputRaw.toString(),
      toAmountUSD: outputHuman.toFixed(2),
      approvalAddress: APPROVALS.lifi,
      feeCosts: [],
      gasCosts: [],
    },
    action: {
      fromToken: { address: inputToken, symbol: tokenMeta(inputToken).symbol, decimals: inDec, priceUSD: '1' },
      toToken: { address: outputToken, symbol: tokenMeta(outputToken).symbol, decimals: outDec, priceUSD: '1' },
    },
    transactionRequest: {
      to: ROUTERS.lifi,
      data: encodeEchoSwap(
        inputToken,
        outputToken,
        inputRaw,
        outputRaw,
        params.fromAddress as Hex,
        params.toAddress as Hex
      ),
      value: nativeValueHex(inputToken, inputRaw),
    },
  };
};

export const makeBebopResponse = (
  params: Record<string, string>,
  rateMul?: (inputToken: Hex, outputToken: Hex) => number
) => {
  const inputToken = params.sell_tokens as Hex;
  const outputToken = params.buy_tokens as Hex;
  const inDec = tokenMeta(inputToken).decimals;
  const outDec = tokenMeta(outputToken).decimals;
  const r = rate('bebop', inputToken, outputToken).mul(rateMul?.(inputToken, outputToken) ?? 1);
  const exactOut = params.buy_amounts !== undefined;

  const outputHuman = exactOut
    ? fromRaw(BigInt(params.buy_amounts), outDec)
    : fromRaw(BigInt(params.sell_amounts), inDec).mul(r);
  const inputHuman = exactOut ? outputHuman.div(r) : fromRaw(BigInt(params.sell_amounts), inDec);
  const inputRaw = toRaw(inputHuman, inDec);
  const outputRaw = toRaw(outputHuman, outDec);

  return {
    routes: [
      {
        quote: {
          buyTokens: {
            [outputToken]: {
              minimumAmount: outputRaw.toString(),
              priceUsd: tokenMeta(outputToken).symbol === 'WETH' ? 2500 : 1,
              symbol: tokenMeta(outputToken).symbol,
              decimals: outDec,
            },
          },
          sellTokens: {
            [inputToken]: {
              amount: inputRaw.toString(),
              priceUsd: tokenMeta(inputToken).symbol === 'WETH' ? 2500 : 1,
              symbol: tokenMeta(inputToken).symbol,
              decimals: inDec,
            },
          },
          approvalTarget: APPROVALS.bebop,
          tx: {
            to: ROUTERS.bebop,
            data: encodeEchoSwap(
              inputToken,
              outputToken,
              inputRaw,
              outputRaw,
              getAddress(params.taker_address),
              getAddress(params.receiver_address)
            ),
            value: nativeValueHex(inputToken, inputRaw),
          },
          expiry: Math.floor(2_000_000_000),
        },
      },
    ],
  };
};

/* ────────────────────────────────────────────────────────────────────────────
 * Call decoding — classify a {to,data,value} against the known ABI set
 * ──────────────────────────────────────────────────────────────────────────── */
const DECODE_ABIS: Abi[] = [
  MOCK_SWAP_ABI as unknown as Abi,
  erc20Abi as unknown as Abi,
  ERC20PermitABI as unknown as Abi,
  DAI_PERMIT_ABI as unknown as Abi,
  EVMVaultABI as unknown as Abi,
  VAULT_ABI_MAYAN as unknown as Abi,
  SWEEPER_ABI as unknown as Abi,
];

export type DecodedCall = {
  to: Hex;
  value: bigint;
  fn: string;
  args: readonly unknown[];
};

export const classifyCall = (call: { to: Hex; data: Hex; value: bigint }): DecodedCall => {
  for (const abi of DECODE_ABIS) {
    try {
      const { functionName, args } = decodeFunctionData({ abi, data: call.data });
      return { to: call.to, value: call.value, fn: functionName, args: (args ?? []) as readonly unknown[] };
    } catch {
      continue;
    }
  }
  return { to: call.to, value: call.value, fn: `unknown(${slice(call.data, 0, 4)})`, args: [] };
};

export const decodeSbcCalls = (sbcTx: SBCTx): DecodedCall[] =>
  sbcTx.calls.map((c) => classifyCall({ to: c.to, data: c.data, value: BigInt(c.value) }));

/* ────────────────────────────────────────────────────────────────────────────
 * Realistic wrapper COT balances. The #84/#86 reclaim reads balanceOf(COT, wrapper) to bridge the
 * COT that actually landed and to size the destination surplus transfer; a flat 0 stub zeroes the
 * reclaim'd bridge (no deposit) and skips the transfer. So the middleware records the COT each source
 * swap PRODUCES (the echoed swap output) and each bridge DELIVERS (the RFF destination value), and
 * readContractStub serves balanceOf from it. Keyed by token address (which encodes the chain).
 * makeCharMiddleware resets it per test.
 * ──────────────────────────────────────────────────────────────────────────── */
const COT_TOKENS = new Set([USDC_ARB, USDC_OP, USDC_BASE].map((a) => a.toLowerCase()));
const cotBalanceByToken = new Map<string, bigint>();
export const wrapperCotBalanceOf = (token: Hex): bigint =>
  cotBalanceByToken.get(token.toLowerCase()) ?? 0n;
const addCotBalance = (token: Hex, amount: bigint) =>
  cotBalanceByToken.set(token.toLowerCase(), wrapperCotBalanceOf(token) + amount);
const resetCotBalances = () => cotBalanceByToken.clear();
// A source swap PRODUCES COT (output token is a COT); a dst/gas swap consumes it. Record production.
const recordProducedCot = (calls: DecodedCall[]) => {
  for (const c of calls) {
    // a source swap produces COT (its output token is a COT)
    if (c.fn === 'swap' && COT_TOKENS.has((c.args[1] as Hex).toLowerCase())) {
      addCotBalance(c.args[1] as Hex, c.args[3] as bigint);
    }
    // a COT-direct fast-path funds the wrapper straight from the EOA (transferFrom of the COT itself);
    // `transfer` (Safe→ephemeral internal move, dst leftover) is NOT a new arrival, so only transferFrom.
    if (c.fn === 'transferFrom' && COT_TOKENS.has(c.to.toLowerCase())) {
      addCotBalance(c.to, c.args[2] as bigint);
    }
  }
};
// The bridge DELIVERS COT to the dst wrapper — record each RFF COT destination so the dst-swap
// surplus read (balanceOf(dstCOT, dstWrapper)) sees the landed amount.
const recordDeliveredCot = (destinations: ReadonlyArray<{ contract_address: Hex; value: string }>) => {
  for (const d of destinations) {
    const token = (`0x${d.contract_address.slice(-40)}`) as Hex;
    if (COT_TOKENS.has(token.toLowerCase())) addCotBalance(token, BigInt(d.value));
  }
};

// Unpack a Safe execute request into its inner calls. operation 0 = single CALL;
// operation 1 = MultiSendCallOnly DELEGATECALL carrying tightly-packed sub-calls.
export const decodeSafeRequest = (req: CreateSafeExecuteTxRequest): DecodedCall[] => {
  if (req.operation === 0) {
    return [classifyCall({ to: req.to, data: req.data, value: BigInt(req.value) })];
  }
  const [packed] = decodeFunctionData({ abi: multiSendCallOnlyAbi, data: req.data }).args as [Hex];
  const calls: DecodedCall[] = [];
  let offset = 0;
  const bytes = packed;
  const total = size(bytes);
  while (offset < total) {
    // 1 op + 20 to + 32 value + 32 len + data
    const to = getAddress(slice(bytes, offset + 1, offset + 21)) as Hex;
    const value = BigInt(slice(bytes, offset + 21, offset + 53));
    const len = Number(BigInt(slice(bytes, offset + 53, offset + 85)));
    const data = (len === 0 ? '0x' : slice(bytes, offset + 85, offset + 85 + len)) as Hex;
    calls.push(classifyCall({ to, data, value }));
    offset += 85 + len;
  }
  return calls;
};

export const decodeEoaRawTx = (raw: Hex): DecodedCall => {
  const tx = parseTransaction(raw);
  return classifyCall({
    to: (tx.to ?? '0x') as Hex,
    data: (tx.data ?? '0x') as Hex,
    value: tx.value ?? 0n,
  });
};

// EOA-submitted native txs wrap the real call in a Calibur `execute` (7702). Unwrap to the inner
// calls; falls back to a direct classify for a plain tx.
export const decodeEoaTx = (raw: Hex): { value: bigint; calls: DecodedCall[] } => {
  const tx = parseTransaction(raw);
  const value = tx.value ?? 0n;
  const data = (tx.data ?? '0x') as Hex;
  try {
    const decoded = decodeFunctionData({ abi: CALIBUR_EXECUTE_ABI, data });
    if (decoded.functionName === 'execute') {
      const sbc = decoded.args[0] as {
        batchedCall: { calls: readonly { to: Hex; value: bigint; data: Hex }[] };
      };
      return {
        value,
        calls: sbc.batchedCall.calls.map((c) => classifyCall({ to: c.to, data: c.data, value: c.value })),
      };
    }
  } catch {
    /* not a Calibur execute */
  }
  return { value, calls: [classifyCall({ to: (tx.to ?? '0x') as Hex, data, value })] };
};

// Ordered, exact assertion of a decoded call list against expectations.
export type ExpectedCall = {
  fn: string;
  to?: Hex;
  value?: bigint;
  args?: readonly unknown[]; // exact full args; or use argsMatch for partial
  argsMatch?: (args: readonly unknown[]) => void;
};

export const expectCallSequence = (actual: DecodedCall[], expected: ExpectedCall[], label = '') => {
  expect(actual.map((c) => c.fn), `${label} call order`).toEqual(expected.map((e) => e.fn));
  expected.forEach((exp, i) => {
    const got = actual[i]!;
    const at = `${label}[${i}] ${exp.fn}`;
    if (exp.to !== undefined) expect(got.to.toLowerCase(), `${at} to`).toBe(exp.to.toLowerCase());
    if (exp.value !== undefined) expect(got.value, `${at} value`).toBe(exp.value);
    if (exp.args !== undefined) expect(got.args, `${at} args`).toEqual(exp.args);
    if (exp.argsMatch) exp.argsMatch(got.args);
  });
};

/* ────────────────────────────────────────────────────────────────────────────
 * Real EOA wallet — real encode + sign; only the network send is faked.
 * Captures every signed raw tx (decoded for assertions).
 * ──────────────────────────────────────────────────────────────────────────── */
export type EoaWalletHarness = {
  wallet: WalletClient;
  sentTxs: Array<{ chainId: number; raw: Hex; call: DecodedCall }>;
};

export const makeRealEoaWallet = (account: PrivateKeyAccount = EOA_ACCOUNT): EoaWalletHarness => {
  const sentTxs: EoaWalletHarness['sentTxs'] = [];
  const nonceByChain = new Map<number, number>();
  let lastChainId = 0;

  const send = async (chainId: number, to: Hex, data: Hex, value: bigint): Promise<Hex> => {
    const nonce = nonceByChain.get(chainId) ?? 0;
    nonceByChain.set(chainId, nonce + 1);
    // Real RLP encode + secp256k1 signature; network broadcast is the only faked part.
    const raw = (await account.signTransaction({
      to,
      data,
      value,
      nonce,
      gas: 1_000_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      chainId,
      type: 'eip1559',
    })) as Hex;
    // S1: independently recover the signer from the serialized tx — proves the EOA genuinely
    // authorized this (native deposit / source-swap / direct approve), not just that signing ran.
    const recovered = await recoverTransactionAddress({ serializedTransaction: raw });
    expect(recovered.toLowerCase(), 'EOA tx must be signed by the EOA').toBe(account.address.toLowerCase());
    recordProducedCot(decodeEoaTx(raw).calls); // an EOA-submitted native source swap lands COT at the wrapper
    sentTxs.push({ chainId, raw, call: decodeEoaTx(raw).calls[0] ?? decodeEoaRawTx(raw) });
    return keccak256(raw);
  };

  const wallet = {
    account,
    sendTransaction: (a: { to: Hex; data?: Hex; value?: bigint; chain?: { id: number } }) =>
      send(a.chain?.id ?? lastChainId, a.to, a.data ?? '0x', a.value ?? 0n),
    writeContract: (a: {
      address: Hex;
      abi: Abi;
      functionName: string;
      args: readonly unknown[];
      value?: bigint;
      chain?: { id: number };
    }) =>
      send(
        a.chain?.id ?? lastChainId,
        a.address,
        encodeFunctionData({ abi: a.abi, functionName: a.functionName, args: a.args }),
        a.value ?? 0n
      ),
    signTypedData: (a: Parameters<PrivateKeyAccount['signTypedData']>[0]) => account.signTypedData(a),
    signMessage: (a: Parameters<PrivateKeyAccount['signMessage']>[0]) => account.signMessage(a),
    getChainId: async () => lastChainId,
    switchChain: async ({ id }: { id: number }) => {
      lastChainId = id;
    },
    addChain: async () => undefined,
  } as unknown as WalletClient;

  return { wallet, sentTxs };
};

/* ────────────────────────────────────────────────────────────────────────────
 * Fake public-client reads (canned). The vi.mock('viem') in the test wires
 * createPublicClient to a client whose methods delegate here.
 * ──────────────────────────────────────────────────────────────────────────── */
export const readContractStub = async (req: {
  address: Hex;
  functionName: string;
}): Promise<unknown> => {
  switch (req.functionName) {
    case 'name':
      return tokenMeta(req.address).name;
    case 'symbol':
      return tokenMeta(req.address).symbol;
    case 'decimals':
      return tokenMeta(req.address).decimals;
    case 'allowance':
      return 0n;
    case 'nonces':
    case 'getNonce':
    case 'nonce':
      return 0n;
    case 'balanceOf':
      return wrapperCotBalanceOf(req.address);
    default:
      throw new Error(`Unhandled readContract ${req.functionName} on ${req.address}`);
  }
};

/* ────────────────────────────────────────────────────────────────────────────
 * Chain object + chain-list overrides
 * ──────────────────────────────────────────────────────────────────────────── */
export const makeViemChain = (id: number): Chain => ({
  id,
  name: `Chain ${id}`,
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: { default: { http: [`https://rpc-${id}.example`] } },
});

export const VAULT_ABI = EVMVaultABI;
export const MAYAN_VAULT_ABI = VAULT_ABI_MAYAN;
export { toHex };

/* ────────────────────────────────────────────────────────────────────────────
 * ChainList override — vault addresses, per-chain 7702, native + token lookups
 * ──────────────────────────────────────────────────────────────────────────── */
import type { ChainListType, TokenInfo } from '../../src/domain';
import { makeSwapChainList } from './swap';

const EXTRA_TOKENS: Record<string, TokenInfo> = {
  [SOURCE_DAI.toLowerCase()]: {
    contractAddress: SOURCE_DAI,
    decimals: 18,
    logo: '',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    permitVariant: 2,
    permitVersion: 1,
  },
  [WETH.toLowerCase()]: {
    contractAddress: WETH,
    decimals: 18,
    logo: '',
    name: 'Wrapped Ether',
    symbol: 'WETH',
  },
};

// The shared fixture tags USDC permitVariant=2 (DAI), but real USDC is EIP-2612 canonical (1) and
// the Safe bridge vault permit requires canonical-2612 — coerce so non-7702 source scenarios work.
const coerceUsdcPermit = <T extends { symbol?: string } | undefined>(token: T): T =>
  token && token.symbol === 'USDC'
    ? ({ ...token, permitVariant: 1, permitVersion: 2 } as T)
    : token;

export const makeCharChainList = (opts: { non7702?: number[] } = {}): ChainListType => {
  const non7702 = new Set(opts.non7702 ?? []);
  const chainList = makeSwapChainList();
  const baseGetChain = chainList.getChainByID;
  const baseGetToken = chainList.getTokenByAddress;
  const baseGetTokenByCurrencyId = chainList.getTokenByCurrencyId;

  chainList.getTokenByCurrencyId = vi
    .fn()
    .mockImplementation((chainId: number, currencyId: number) =>
      coerceUsdcPermit(baseGetTokenByCurrencyId(chainId, currencyId))
    );

  chainList.getVaultContractAddress = vi
    .fn()
    .mockImplementation((chainId: number) => VAULT_BY_CHAIN[chainId] ?? VAULT_BY_CHAIN[BASE_CHAIN]);

  chainList.getChainByID = vi.fn().mockImplementation((chainId: number) => ({
    ...baseGetChain(chainId),
    supports7702: !non7702.has(chainId),
    blockExplorers: { default: { name: 'explorer', url: 'https://example.com' } },
  }));

  chainList.getNativeToken = vi.fn().mockImplementation((chainId: number) => {
    const chain = chainList.getChainByID(chainId);
    return {
      contractAddress: EADDRESS as Hex,
      decimals: chain.nativeCurrency.decimals,
      logo: '',
      name: chain.nativeCurrency.name,
      symbol: chain.nativeCurrency.symbol,
    };
  });

  chainList.getTokenByAddress = vi.fn().mockImplementation((chainId: number, tokenAddress: Hex) => {
    if (isNativeAddress(tokenAddress))
      return { contractAddress: tokenAddress, decimals: 18, symbol: 'ETH', name: 'Ether', logo: '', currencyId: 3, mayanEnabled: true };
    const extra = EXTRA_TOKENS[tokenAddress.toLowerCase()];
    if (extra) return { ...extra, mayanEnabled: true };
    const known = coerceUsdcPermit(baseGetToken(chainId, tokenAddress));
    // Production createChainList THROWS tokenNotSupported for unknown tokens; the base fixture
    // returns undefined. Mirror production so unknown-token cells fail the way the SDK really does.
    if (!known) throw new Error(`Token ${tokenAddress} not supported on chain ${chainId}`);
    return known;
  });

  // The base fixture leaves getTokenInfoBySymbol unimplemented; buildQuoteRequest (same-token bridge
  // fee quote) dereferences it, so provide symbol→token. Native ETH is needed for ETH→ETH bridges.
  chainList.getTokenInfoBySymbol = vi.fn().mockImplementation((chainId: number, symbol: string) => {
    if (symbol === 'ETH')
      return { contractAddress: EADDRESS as Hex, decimals: 18, symbol: 'ETH', name: 'Ether', logo: '' };
    if (symbol === 'USDC') return chainList.getTokenByCurrencyId(chainId, 1);
    if (symbol === 'DAI') return { ...EXTRA_TOKENS[SOURCE_DAI.toLowerCase()], mayanEnabled: true };
    if (symbol === 'WETH') return { ...EXTRA_TOKENS[WETH.toLowerCase()], mayanEnabled: true };
    throw new Error(`no token for symbol ${symbol} on chain ${chainId}`);
  });

  return chainList;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Middleware fake (capturing). Nexus by default; Mayan via provider:'mayan'.
 * ──────────────────────────────────────────────────────────────────────────── */
import { makeMiddlewareClient } from './middleware-client';
import type { MiddlewareClient } from '../../src/transport';
import type { FlatBalance } from '../../src/swap/types';

export type CharMiddleware = MiddlewareClient & {
  getLiFiQuote: ReturnType<typeof vi.fn>;
  getBebopQuote: ReturnType<typeof vi.fn>;
  getMayanQuotes: ReturnType<typeof vi.fn>;
  submitSBCs: ReturnType<typeof vi.fn>;
  createSafeExecuteTx: ReturnType<typeof vi.fn>;
  ensureSafeAccount: ReturnType<typeof vi.fn>;
  submitRFF: ReturnType<typeof vi.fn>;
  getRFF: ReturnType<typeof vi.fn>;
  reportMayanNativeTx: ReturnType<typeof vi.fn>;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Requote-drift injector. Induces the ONE thing the deterministic suite can't:
 * executed ≠ planned. It rides only true external edges — a failed source-swap
 * dispatch (the chain rejected the tx) + a moved aggregator rate — so the real
 * requoteFailedChains / pooled-buffer guard / mergeBridgeAssets / Nexus
 * re-derivation / refreshMayanQuotesForExecution all run unmocked downstream.
 *
 *   1. The first source-swap SBC on `chainId` returns `errored` → the flow re-quotes it.
 *   2. From that moment the winning aggregator re-prices `sourceToken→COT` by `factor`
 *      (>1 up, <1 down), so the re-quoted (executed) output A ≠ planned P.
 * ──────────────────────────────────────────────────────────────────────────── */
export type RequoteDrift = {
  /** submitSBCs hook: true (and arms the drift) for the first source-swap batch on the target chain. */
  shouldFailSourceSwap: (tx: SBCTx) => boolean;
  /** Aggregator rate multiplier — `factor` once armed, for the failing leg's `sourceToken` pair only. */
  rateMul: (inputToken: Hex, outputToken: Hex) => number;
};

export const makeRequoteDrift = (opts: {
  chainId: number; // source chain whose first source-swap attempt fails
  sourceToken: Hex; // token of that leg — scopes the drift to its sourceToken→COT pair
  factor: number; // re-quote output multiplier: >1 drifts up, <1 drifts down
}): RequoteDrift => {
  let armed = false;
  let failed = false;
  return {
    shouldFailSourceSwap: (tx) => {
      if (failed || tx.chainId !== opts.chainId || tx.calls.length === 0) return false;
      if (!decodeSbcCalls(tx).some((c) => c.fn === 'swap')) return false; // not the source swap (bridge/deposit)
      failed = true;
      armed = true;
      return true;
    },
    rateMul: (inputToken) =>
      armed && inputToken.toLowerCase() === opts.sourceToken.toLowerCase() ? opts.factor : 1,
  };
};

const RFF_HASH = '0x9999999999999999999999999999999999999999999999999999999999999999' as Hex;

export const makeCharMiddleware = (opts: {
  balances: FlatBalance[];
  provider?: 'nexus' | 'mayan';
  getMayanQuotes?: (params: unknown) => unknown;
  drift?: RequoteDrift;
}): CharMiddleware => {
  resetCotBalances(); // fresh wrapper COT ledger per test
  const oraclePrices = [ARB_CHAIN, OP_CHAIN, BASE_CHAIN].flatMap((chainId) => [
    {
      universe: 'EVM' as const,
      chainId,
      // Native gas price is looked up by ZERO_ADDRESS (intent.ts convertGasToToken), not EADDRESS.
      tokenAddress: '0x0000000000000000000000000000000000000000' as Hex,
      tokenSymbol: 'ETH',
      tokenDecimals: 18,
      priceUsd: new Decimal(2500),
      timestamp: 1,
    },
    {
      universe: 'EVM' as const,
      chainId,
      tokenAddress: ({ [ARB_CHAIN]: USDC_ARB, [OP_CHAIN]: USDC_OP, [BASE_CHAIN]: USDC_BASE }[chainId])!,
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
      priceUsd: new Decimal(1),
      timestamp: 1,
    },
  ]);

  return makeMiddlewareClient({
    getSwapBalances: vi.fn().mockResolvedValue(opts.balances),
    getOraclePrices: vi.fn().mockResolvedValue(oraclePrices),
    getLiFiQuote: vi
      .fn()
      .mockImplementation(async (params: Record<string, string>, exactOut?: boolean) =>
        makeLiFiResponse(params, Boolean(exactOut), opts.drift?.rateMul)
      ),
    getBebopQuote: vi
      .fn()
      .mockImplementation(async (params: Record<string, string>) =>
        makeBebopResponse(params, opts.drift?.rateMul)
      ),
    getFibrousQuote: vi.fn().mockResolvedValue(null),
    getQuote: vi.fn().mockResolvedValue({
      fulfillmentBps: 0,
      sources: [ARB_CHAIN, OP_CHAIN, BASE_CHAIN].map((chainId) => ({
        chainId,
        tokenAddress: ({ [ARB_CHAIN]: USDC_ARB, [OP_CHAIN]: USDC_OP, [BASE_CHAIN]: USDC_BASE }[chainId])!,
        depositFeeUsd: '0',
        depositFeeToken: '0',
      })),
      destination: {
        chainId: BASE_CHAIN,
        tokenAddress: USDC_BASE,
        fulfillmentFeeUsd: '0',
        fulfillmentFeeToken: '0',
      },
    }),
    getBridgeProvider: vi.fn().mockResolvedValue({ provider: opts.provider ?? 'nexus' }),
    // One Mayan quote per requested source. minReceived = human(amount) → zero haircut (gross −
    // Σ minReceived). Shape mirrors tests/swap/route-mayan.test.ts.
    getMayanQuotes: vi.fn().mockImplementation(
      opts.getMayanQuotes ??
        (async (req: { sources: { chain_id: string; contract_address: Hex; amount: string }[] }) => ({
          destination: { chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
          quotes: req.sources.map((s) => ({
            source: { chainId: Number(BigInt(s.chain_id)), tokenAddress: s.contract_address, amount: s.amount },
            mayanQuote: {
              // Mayan like-for-like: the SWIFT order's signed input == the amount you offer it, so
              // echo the requested leg amount. A route-time quote freezes at the planned amount;
              // refreshMayanQuotesForExecution re-quotes at the executed amount → effectiveAmountIn64
              // re-aligns to what the RFF actually deposits. Matches mayan-bridge-requote.test.ts.
              effectiveAmountIn64: s.amount,
              effectiveAmountIn: Number(formatUnits(BigInt(s.amount), tokenMeta(s.contract_address).decimals)),
              minReceived: Number(formatUnits(BigInt(s.amount), tokenMeta(s.contract_address).decimals)),
              protocolBps: 3,
            },
          })),
        }))
    ),
    submitSBCs: vi
      .fn()
      .mockImplementation(async (txs: SBCTx[]) =>
        txs.map((tx, i) => {
          // Drift injection rides this true external edge: the chain rejects the first source-swap
          // dispatch (errored), so requireSuccessfulSbcResult throws → requoteFailedChains re-quotes.
          if (opts.drift?.shouldFailSourceSwap(tx)) {
            return {
              chainId: tx.chainId,
              address: tx.address,
              errored: true as const,
              message: 'simulated source-swap dispatch failure (requote drift)',
            };
          }
          recordProducedCot(decodeSbcCalls(tx)); // this batch's source swap landed COT at the wrapper
          return {
            chainId: tx.chainId,
            address: tx.address,
            errored: false as const,
            txHash: (`0x${(i + 1).toString(16).padStart(64, '0')}`) as Hex,
          };
        })
      ),
    createSafeExecuteTx: vi
      .fn()
      .mockImplementation(async (req: CreateSafeExecuteTxRequest) => {
        recordProducedCot(decodeSafeRequest(req)); // Safe source swap landed COT at the predicted Safe
        return {
          chainId: req.chainId,
          safeAddress: req.safeAddress,
          txHash: (`0x${'5a'.repeat(32)}`) as Hex,
        };
      }),
    ensureSafeAccount: vi.fn().mockResolvedValue({
      chainId: BASE_CHAIN,
      owner: EPH,
      address: PREDICTED_SAFE,
      factoryAddress: '0x0000000000000000000000000000000000000000' as Hex,
      exists: true,
    }),
    getSafeAccountAddress: vi.fn().mockResolvedValue({ address: PREDICTED_SAFE }),
    // Models the middleware's server-side guard (NOT in SDK src, so no other test sees it): a Mayan
    // RFF must deposit EXACTLY the per-leg signed input. `mayanQuotes` is positional with
    // `request.sources` (both built from `intent.selectedSources` order). This is the enforcement
    // the deterministic suite lacked — without it the value↔effectiveAmountIn drift (a4ba539) is
    // invisible. Permanent hardening: it just passes for a matched (Nexus or refreshed-Mayan) RFF.
    submitRFF: vi.fn().mockImplementation(
      async (payload: {
        request: {
          sources: Array<{ value: string }>;
          destinations: Array<{ contract_address: Hex; value: string }>;
        };
        mayanQuotes?: Array<{ effectiveAmountIn64: string }>;
      }) => {
        (payload.mayanQuotes ?? []).forEach((q, i) => {
          const value = BigInt(payload.request.sources[i].value);
          const effectiveIn = BigInt(q.effectiveAmountIn64);
          if (value !== effectiveIn) {
            throw new Error(`Mayan quote amount mismatch for source ${i}`);
          }
        });
        recordDeliveredCot(payload.request.destinations); // bridge delivers this COT to the dst wrapper
        return { request_hash: RFF_HASH };
      }
    ),
    getRFF: vi.fn().mockResolvedValue({
      request: {
        sources: [],
        destination_universe: 'EVM',
        destination_chain_id: '0x',
        recipient_address: '0x',
        destinations: [],
        nonce: '0',
        expiry: '0',
        parties: [],
      },
      request_hash: RFF_HASH,
      status: 'fulfilled',
      solver: null,
    }),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'fulfilled' }),
    reportMayanNativeTx: vi.fn().mockResolvedValue({ success: true }),
  }) as CharMiddleware;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Captured-batch accessors (ordered, per chain). Each SBC/Safe invocation is one
 * batch; per chain, source-swap batches precede bridge-deposit batches.
 * ──────────────────────────────────────────────────────────────────────────── */
// Empty-calls SBCs are 7702 auth bootstraps (delegation only) — filter them so batch indices line
// up with real operations.
export const sbcBatchesForChain = (mw: CharMiddleware, chainId: number): DecodedCall[][] =>
  mw.submitSBCs.mock.calls
    .flatMap((args) => args[0] as SBCTx[])
    .filter((tx) => tx.chainId === chainId && tx.calls.length > 0)
    .map((tx) => decodeSbcCalls(tx));

export const safeBatchesForChain = (mw: CharMiddleware, chainId: number): DecodedCall[][] =>
  mw.createSafeExecuteTx.mock.calls
    .map((args) => args[0] as CreateSafeExecuteTxRequest)
    .filter((req) => req.chainId === chainId)
    .map((req) => decodeSafeRequest(req));

export const bytes32Address = (address: Hex): Hex =>
  (`0x${address.slice(2).toLowerCase().padStart(64, '0')}`) as Hex;

// The full RFF request the flow signed + submitted (sources/destinations carry the bridged amounts
// as decimal strings; recipient_address is the bridge receiver as bytes32).
export type CharRffRequest = {
  sources: Array<{ chain_id: string; contract_address: Hex; value: string }>;
  destinations: Array<{ contract_address: Hex; value: string }>;
  recipient_address: Hex;
};
export const rffRequest = (mw: CharMiddleware): CharRffRequest =>
  (mw.submitRFF.mock.calls[0]?.[0] as { request: CharRffRequest }).request;

export const rffRecipient = (mw: CharMiddleware): Hex => rffRequest(mw).recipient_address;

// S2 — invocationCallOrder of the submitSBCs call whose batch contains a decoded call matching `fn`
// (e.g. 'deposit'). Lets a scenario pin cross-seam ordering against submitRFF's order.
export const sbcCallOrderWith = (mw: CharMiddleware, fn: string): number => {
  const idx = mw.submitSBCs.mock.calls.findIndex((args) =>
    (args[0] as SBCTx[]).some((tx) => decodeSbcCalls(tx).some((c) => c.fn === fn))
  );
  if (idx < 0) throw new Error(`no submitSBCs batch contained a '${fn}' call`);
  return mw.submitSBCs.mock.invocationCallOrder[idx];
};

// S5 — the COMPLETE set of chains that received a real on-chain batch (non-empty SBC or any Safe
// exec). Lets a scenario assert there are NO stray batches on unexpected chains.
export const dispatchedChains = (mw: CharMiddleware): number[] => {
  const sbc = mw.submitSBCs.mock.calls
    .flatMap((args) => args[0] as SBCTx[])
    .filter((tx) => tx.calls.length > 0)
    .map((tx) => tx.chainId);
  const safe = mw.createSafeExecuteTx.mock.calls.map((args) => (args[0] as CreateSafeExecuteTxRequest).chainId);
  return [...new Set([...sbc, ...safe])].sort((a, b) => a - b);
};
