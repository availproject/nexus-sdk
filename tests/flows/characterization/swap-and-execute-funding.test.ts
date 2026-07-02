// Honest characterization of the swapAndExecute *funding decision* — the swap&execute-specific code.
//
// REAL: a chainList built from a focused deployment via createChainList (NO lookup mocks — unknown
// tokens throw `tokenNotSupported` exactly like production), buildSwapPreflight, getDestinationBalances,
// computeShortfall, createFundingSwapInput.
// MOCKED: the inner-swap seam — buildSwapPreviewState (route) and swap() (execution) are spied so the
// test doesn't depend on inner-route quoting (owned by tests/swap/characterization/swap.test.ts) and
// can capture exactly what swapAndExecute forwards — plus the true external edges (RPC/middleware/wallet).
//
// Pins the decision: skip-vs-fund, the reserve/shortfall sentinels, the sources allowlist (gates token
// AND gas; empty → throw), and unknown destination tokens — with and without a tokenApproval.
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUnits, type Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { SwapAndExecuteIntent } from '../../../src';
import type { DeploymentResponse } from '../../../src/domain';
import { createChainList } from '../../../src/services/chain-list';
import { EADDRESS } from '../../../src/swap/constants';
import type { SwapData } from '../../../src/swap/types';
import { makeSwapMiddlewareClient } from '../../helpers/middleware-client';
import { ARB_CHAIN, USDC_ARB } from '../../helpers/swap';

// Seam = the inner swap (preview AND execution). We mock both `buildSwapPreviewState` (so the test
// doesn't depend on inner-route quoting — that's swap.test.ts's job) and `swap` (execution), then
// capture exactly what swapAndExecute forwards. computeShortfall / getDestinationBalances /
// createFundingSwapInput / createSwapAndExecuteIntent and buildSwapPreflight all stay REAL.
const swapSpy = vi.hoisted(() => vi.fn());
const buildPreviewSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../src/flows/swap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/flows/swap')>();
  return { ...actual, swap: swapSpy, buildSwapPreviewState: buildPreviewSpy };
});

// ── Public-client reads routed through a stub (mock createPublicClient); rest of viem stays real. ──
const hoisted = vi.hoisted(() => {
  const readContract = vi.fn();
  const multicall = vi.fn();
  const getCode = vi.fn();
  const getTransactionCount = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const simulateContract = vi.fn();
  const watchContractEvent = vi.fn();
  const getFeeHistory = vi.fn();
  const estimateGas = vi.fn();
  const getBalance = vi.fn();
  const createPublicClient = vi.fn((options?: { chain?: unknown }) => ({
    chain: options?.chain,
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    simulateContract,
    watchContractEvent,
    getFeeHistory,
    estimateGas,
    getBalance,
  }));
  return {
    createPublicClient,
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    simulateContract,
    watchContractEvent,
    getFeeHistory,
    estimateGas,
    getBalance,
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: hoisted.createPublicClient,
    http: vi.fn().mockReturnValue({}),
    fallback: vi.fn().mockReturnValue({}),
  };
});

import { swapAndExecute } from '../../../src/flows/swap-and-execute';

const NATIVE = EADDRESS as Hex;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex;
const USER_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Hex;
const TARGET_CONTRACT = '0x3333333333333333333333333333333333333333' as Hex;
const SOURCE_DAI = '0x0000000000000000000000000000000000000da1' as Hex;
// A token the deployment list has never heard of — swap aggregators can still support it.
const UNKNOWN_TOKEN = '0x00000000000000000000000000000000facade01' as Hex;
const EXECUTE_TX_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex;

const oraclePrices = [
  { universe: 'EVM' as const, chainId: ARB_CHAIN, tokenAddress: USDC_ARB, tokenSymbol: 'USDC', tokenDecimals: 6, priceUsd: new Decimal(1), timestamp: 1 },
  { universe: 'EVM' as const, chainId: ARB_CHAIN, tokenAddress: ZERO_ADDRESS, tokenSymbol: 'ETH', tokenDecimals: 18, priceUsd: new Decimal(3000), timestamp: 1 },
];

// A REAL chainList from a focused deployment — getChainByID / getTokenByAddress / resolveCOT all run
// per production code. USDC + DAI are known; any other token throws `tokenNotSupported`, exactly like
// the deployed SDK. No lookup mocks lying about what's supported.
const DEPLOYMENT: DeploymentResponse = {
  network: 'testnet',
  statekeeperUrl: 'http://localhost:9080',
  fulfillmentBps: 0,
  mayanEnabled: false,
  mayanThresholdUsd: 0,
  mayanCancelRefundMaxPercentage: 0,
  chains: [
    {
      chainId: ARB_CHAIN,
      universe: 'EVM',
      name: 'Arbitrum',
      rpcUrl: 'https://example.com/arb',
      vaultAddress: '0x4444444444444444444444444444444444440001',
      multicallAddress: '0x00000000000000000000000000000000000000aa',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logo: '', currencyId: 3 },
      sponsored: false,
      explorerUrl: 'https://arbiscan.io',
      logo: '',
      tokens: [
        { symbol: 'USDC', name: 'USD Coin', address: USDC_ARB, decimals: 6, balanceSlot: 9, logo: '', currencyId: 1 },
        { symbol: 'DAI', name: 'Dai Stablecoin', address: SOURCE_DAI, decimals: 18, balanceSlot: 2, logo: '', currencyId: 5 },
      ],
    },
  ],
};
const chainList = createChainList(DEPLOYMENT);

const makeEvmClient = () => {
  let chainId = ARB_CHAIN;
  return {
    getChainId: vi.fn().mockImplementation(async () => chainId),
    switchChain: vi.fn().mockImplementation(async ({ id }: { id: number }) => { chainId = id; }),
    addChain: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue({ [ARB_CHAIN]: { atomic: { status: 'supported' } } }),
    sendCalls: vi.fn().mockResolvedValue({ id: '0xcallid' }),
    waitForCallsStatus: vi.fn().mockResolvedValue({ status: 'success', receipts: [{ transactionHash: EXECUTE_TX_HASH }] }),
    sendTransaction: vi.fn().mockResolvedValue(EXECUTE_TX_HASH),
    writeContract: vi.fn(),
    request: vi.fn().mockResolvedValue('0xa4b1'),
  };
};

const makeEphemeralWallet = (): PrivateKeyAccount =>
  ({
    address: '0xbbbb000000000000000000000000000000000002' as Hex,
    signMessage: vi.fn().mockResolvedValue('0x' + '33'.repeat(65)),
    signTypedData: vi.fn().mockResolvedValue('0x' + '33'.repeat(65)),
    signAuthorization: vi.fn().mockResolvedValue({ r: '0x01', s: '0x02', yParity: 0, nonce: 0 }),
  }) as unknown as PrivateKeyAccount;

type Balance = { amount: string; chainID: number; decimals: number; name: string; logo: string; symbol: string; tokenAddress: Hex; value: number };

// Inner-swap routing is mocked (buildSwapPreviewState), so the aggregators are never quoted here —
// only the balances + oracle prices the REAL shortfall path reads matter.
const makeMiddleware = (balances: Balance[]) =>
  makeSwapMiddlewareClient({
    getSwapBalances: vi.fn().mockResolvedValue(balances),
    getOraclePrices: vi.fn().mockResolvedValue(oraclePrices),
    getLiFiQuote: vi.fn().mockResolvedValue(null),
    getBebopQuote: vi.fn().mockResolvedValue(null),
    submitRFF: vi.fn(),
    getRFF: vi.fn(),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'created' }),
  });

const bal = (tokenAddress: Hex, amount: string, decimals: number, symbol: string, value: number): Balance => ({
  amount, chainID: ARB_CHAIN, decimals, name: symbol, logo: '', symbol, tokenAddress, value,
});

// Inflated fee so the gas requirement is a sane fraction of an ETH (≈0.1) — lets "holds SOME gas"
// sit below the requirement and produce a real, exact gas shortfall (read back from the intent).
const HIGH_FEE = {
  baseFeePerGas: Array.from({ length: 21 }, () => 1_000_000_000_000n),
  reward: Array.from({ length: 20 }, () => [1_000_000_000_000n, 1_000_000_000_000n, 1_000_000_000_000n]),
  gasUsedRatio: [],
  oldestBlock: 1n,
};
const LOW_FEE = {
  baseFeePerGas: Array.from({ length: 21 }, () => 1n),
  reward: Array.from({ length: 20 }, () => [1n, 1n, 1n]),
  gasUsedRatio: [],
  oldestBlock: 1n,
};

type RunResult = {
  result: Awaited<ReturnType<typeof swapAndExecute>>;
  intent: SwapAndExecuteIntent;
  swapInput: SwapData | undefined;
  swapCalled: boolean;
};

const run = async (opts: {
  balances: Balance[];
  toTokenAddress?: Hex;
  toAmountRaw?: bigint;
  sources?: { chainId: number; tokenAddress: Hex }[];
  tokenApproval?: { toTokenAddress: Hex; amount: bigint; spender: Hex };
}): Promise<RunResult> => {
  const deps = {
    chainList,
    middlewareClient: makeMiddleware(opts.balances),
    intentExplorerUrl: 'https://intent.example',
    evm: { walletClient: makeEvmClient() as never, address: USER_ADDRESS },
    swap: { ephemeralWallet: makeEphemeralWallet(), cotCurrencyId: 1 },
  };
  let intent!: SwapAndExecuteIntent;
  const result = await swapAndExecute(
    {
      toChainId: ARB_CHAIN,
      toTokenAddress: opts.toTokenAddress ?? USDC_ARB,
      toAmountRaw: opts.toAmountRaw ?? 100_000_000n,
      sources: opts.sources,
      execute: {
        to: TARGET_CONTRACT,
        data: '0xdeadbeef' as Hex,
        gas: 100_000n,
        tokenApproval: opts.tokenApproval,
      },
    },
    deps as never,
    {
      onIntent: (d: { intent: SwapAndExecuteIntent; allow: () => void }) => {
        intent = d.intent;
        d.allow();
      },
    }
  );
  const swapCalled = swapSpy.mock.calls.length > 0;
  return {
    result,
    intent,
    swapCalled,
    swapInput: swapCalled ? (swapSpy.mock.calls[0][0] as SwapData) : undefined,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  swapSpy.mockResolvedValue({ sourceSwaps: [], intentExplorerUrl: 'https://intent.example/rff/0xabc' });
  // Canned funding-swap preview — buildCompositePreviewState only reads `.intent` (must be truthy)
  // and `.plan.steps`. The real route is swap.test.ts's concern.
  buildPreviewSpy.mockResolvedValue({ intent: { swapRequired: true }, plan: { steps: [] } });
  hoisted.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (functionName === 'decimals') return 6; // unknown dst token resolves to 6dp via on-chain fetch
    if (functionName === 'symbol') return 'TKN';
    if (functionName === 'name') return 'Token';
    if (functionName === 'gasEstimateL1Component') return [1n, 1n];
    return 0n; // allowance, etc.
  });
  hoisted.multicall.mockResolvedValue([]);
  hoisted.getCode.mockResolvedValue(undefined);
  hoisted.getTransactionCount.mockResolvedValue(0);
  hoisted.getBalance.mockResolvedValue(0n);
  hoisted.estimateGas.mockResolvedValue(70_000n);
  hoisted.waitForTransactionReceipt.mockResolvedValue({ status: 'success', transactionHash: EXECUTE_TX_HASH, blockNumber: 1n, effectiveGasPrice: 1n, gasUsed: 21_000n });
  hoisted.simulateContract.mockResolvedValue({ request: { to: TARGET_CONTRACT, data: '0x', value: 0n } });
  hoisted.watchContractEvent.mockImplementation(() => () => undefined);
  hoisted.getFeeHistory.mockResolvedValue(LOW_FEE);
});

describe('swapAndExecute funding decision', () => {
  const REQUIRED = 100_000_000n; // 100 USDC

  it('case 1 · holds token + gas on dst → no swap required', async () => {
    const { result, intent, swapCalled } = await run({
      balances: [bal(USDC_ARB, '200', 6, 'USDC', 200), bal(NATIVE, '1', 18, 'ETH', 3000)],
    });

    expect(intent.swapRequired, 'enough token + gas → funding skipped').toBe(false);
    expect(swapCalled, 'swap() must NOT be invoked').toBe(false);
    expect(result.swapSkipped).toBe(true);
    expect(result.swapResult).toBeUndefined();
  });

  it('case 2 · holds exact token, no gas → only the GAS requirement goes to swap', async () => {
    const { intent, swapInput } = await run({
      balances: [bal(USDC_ARB, '100', 6, 'USDC', 100)], // exactly required, zero native
    });

    expect(intent.swapRequired).toBe(true);
    // token side: nothing to acquire — the held token is RESERVED (negative sentinel), not swapped for.
    expect(intent.shortfall?.token.amountRaw, 'no token shortfall').toBe(0n);
    expect(swapInput?.data.toAmountRaw, 'token reserved (== −required), NOT a positive ask').toBe(-REQUIRED);
    // gas side: the whole gas requirement is the shortfall and the only positive ask.
    const gasShort = intent.shortfall?.gas.amountRaw ?? 0n;
    expect(gasShort, 'a real gas shortfall exists').toBeGreaterThan(0n);
    expect(swapInput?.data.toNativeAmountRaw, 'gas shortfall forwarded as the native ask').toBe(gasShort);
  });

  it('case 3 · holds some token + some gas → only the SHORTFALL is filled (existing reserved)', async () => {
    hoisted.getFeeHistory.mockResolvedValue(HIGH_FEE);
    const heldGas = parseUnits('0.05', 18);
    const { intent, swapInput } = await run({
      balances: [bal(USDC_ARB, '40', 6, 'USDC', 40), bal(NATIVE, '0.05', 18, 'ETH', 150)],
    });

    expect(intent.swapRequired).toBe(true);
    // token: exactly the 60 USDC delta — the 40 held is NOT swapped away.
    expect(intent.shortfall?.token.amountRaw).toBe(REQUIRED - 40_000_000n);
    expect(swapInput?.data.toAmountRaw, 'positive token shortfall == required − held').toBe(60_000_000n);
    // gas: exactly requirement − held; the held gas is reserved, only the delta is requested.
    const gasReq = intent.executeRequirement.gas.amountRaw;
    expect(gasReq, 'sanity: held gas is below the requirement').toBeGreaterThan(heldGas);
    expect(swapInput?.data.toNativeAmountRaw, 'gas shortfall == requirement − held (existing reserved)').toBe(gasReq - heldGas);
    expect(intent.shortfall?.gas.amountRaw).toBe(gasReq - heldGas);
  });

  it('case 4 · holds MORE than required token + some gas → reserve == REQUIRED, surplus stays usable', async () => {
    hoisted.getFeeHistory.mockResolvedValue(HIGH_FEE);
    const heldGas = parseUnits('0.05', 18);
    const { intent, swapInput } = await run({
      balances: [bal(USDC_ARB, '150', 6, 'USDC', 150), bal(NATIVE, '0.05', 18, 'ETH', 150)],
    });

    expect(intent.swapRequired).toBe(true);
    expect(intent.shortfall?.token.amountRaw, 'no token shortfall (held > required)').toBe(0n);
    // The reservation must be EXACTLY the required amount, NOT the held 150 — otherwise the 50 surplus
    // would be locked instead of usable as a swap source.
    expect(swapInput?.data.toAmountRaw, 'reserve == −required (surplus 50 stays usable)').toBe(-REQUIRED);
    expect(swapInput?.data.toAmountRaw).not.toBe(-150_000_000n);
    // gas shortfall still filled from the surplus / other sources.
    const gasReq = intent.executeRequirement.gas.amountRaw;
    expect(swapInput?.data.toNativeAmountRaw, 'gas shortfall == requirement − held').toBe(gasReq - heldGas);
  });

  it('case 5 · selected sources are forwarded verbatim to the swap call', async () => {
    const sources = [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI }];
    const { swapInput } = await run({
      balances: [bal(SOURCE_DAI, '500', 18, 'DAI', 500)], // no dst USDC, no gas → funding required
      sources,
    });

    expect(swapInput, 'swap() was invoked with a funding input').toBeDefined();
    expect(swapInput?.data.sources, 'sources threaded through to the swap call unchanged').toEqual(sources);
  });

  it('case 6 · unknown destination token does not error (no fixed destination token set)', async () => {
    // User already holds enough of an unknown token → preflight must still resolve it (on-chain
    // metadata fetch) and the flow must complete without a "token not found" throw.
    const { result, intent, swapCalled } = await run({
      toTokenAddress: UNKNOWN_TOKEN,
      balances: [bal(UNKNOWN_TOKEN, '200', 6, 'TKN', 200), bal(NATIVE, '1', 18, 'ETH', 3000)],
    });

    expect(intent.swapRequired, 'sufficient unknown-token balance → no funding swap').toBe(false);
    expect(swapCalled).toBe(false);
    expect(result.swapSkipped).toBe(true);
    expect(result.execute.txHash).toBe(EXECUTE_TX_HASH);
  });

  it('case 7 · dst token absent from sources is acquired (funded from a listed source)', async () => {
    // Holds 100 USDC (the dst token) + 500 DAI, but sources lists only DAI — so the held USDC is NOT
    // counted as available and the funding swap acquires the full amount from DAI. (Before the fix the
    // held USDC counted as available → reservation → gas-only sizing → the Mayan-on-eth error.)
    const sources = [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI }];
    const { intent, swapInput } = await run({
      balances: [bal(USDC_ARB, '100', 6, 'USDC', 100), bal(SOURCE_DAI, '500', 18, 'DAI', 500)],
      sources,
    });

    expect(intent.swapRequired).toBe(true);
    expect(intent.shortfall?.token.amountRaw, 'held USDC excluded → full token shortfall').toBe(REQUIRED);
    expect(swapInput?.data.toAmountRaw, 'token acquired (positive), not reserved').toBe(REQUIRED);
    expect(swapInput?.data.sources).toEqual(sources);
  });

  it('case 8 · sources gates each asset — listing native lets held gas count, unlisted token acquired', async () => {
    // Lists DAI + native: the held ETH counts for gas (reserved, not re-acquired) while the still
    // unlisted USDC is acquired. Proves the allowlist is per-asset, not all-or-nothing.
    const sources = [
      { chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI },
      { chainId: ARB_CHAIN, tokenAddress: NATIVE },
    ];
    const { swapInput } = await run({
      balances: [
        bal(USDC_ARB, '100', 6, 'USDC', 100),
        bal(NATIVE, '1', 18, 'ETH', 3000),
        bal(SOURCE_DAI, '500', 18, 'DAI', 500),
      ],
      sources,
    });

    expect(swapInput?.data.toAmountRaw, 'unlisted USDC → acquired').toBe(REQUIRED);
    expect(swapInput?.data.toNativeAmountRaw ?? 0n, 'listed native → held ETH covers gas, not acquired').not.toBeGreaterThan(0n);
  });

  it('case 9 · sources matching no held balance fails loud (length 0 → throw)', async () => {
    // sources lists DAI but the user holds none — the allowlist filters to empty, so throw a clear
    // error up front instead of collapsing into the opaque downstream "No usable balances".
    await expect(
      run({
        balances: [bal(USDC_ARB, '100', 6, 'USDC', 100), bal(NATIVE, '1', 18, 'ETH', 3000)],
        sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI }],
      })
    ).rejects.toThrow(/requested sources/i);
  });

  it('case 10 · unknown destination token absent from balances → funding swap acquires it (no error)', async () => {
    // Same unknown dst token as case 6, but the user does NOT hold it. It still resolves (on-chain
    // metadata, not the deployment list), produces a full shortfall, and the funding swap targets it
    // — no "token not found" throw, just an acquire.
    const { intent, swapInput, result } = await run({
      toTokenAddress: UNKNOWN_TOKEN,
      balances: [bal(SOURCE_DAI, '500', 18, 'DAI', 500), bal(NATIVE, '1', 18, 'ETH', 3000)],
    });

    expect(intent.swapRequired, 'unknown token not held → funding required').toBe(true);
    expect(swapInput?.data.toTokenAddress, 'funding swap targets the unknown token').toBe(UNKNOWN_TOKEN);
    expect(swapInput?.data.toAmountRaw, 'acquire the full requirement of the unknown token').toBe(REQUIRED);
    expect(result.execute.txHash).toBe(EXECUTE_TX_HASH);
  });

  it('case 11 · unknown dst token WITH a token approval does not error (real-app repro)', async () => {
    // The exact shape that errors in the browser: a tokenApproval for an unknown dst token. The
    // approval only needs the address (calldata + allowance); its metadata is display-only — so
    // swapAndExecute must NOT eagerly `getTokenByAddress` and throw "token not supported".
    const { intent, swapInput, result } = await run({
      toTokenAddress: UNKNOWN_TOKEN,
      balances: [bal(SOURCE_DAI, '500', 18, 'DAI', 500), bal(NATIVE, '1', 18, 'ETH', 3000)],
      tokenApproval: { toTokenAddress: UNKNOWN_TOKEN, amount: REQUIRED, spender: TARGET_CONTRACT },
    });

    expect(intent.swapRequired).toBe(true);
    expect(swapInput?.data.toTokenAddress, 'funding swap targets the unknown token').toBe(UNKNOWN_TOKEN);
    expect(result.execute.txHash).toBe(EXECUTE_TX_HASH);
    // Approval amount renders with the on-chain decimals (6) backfilled from dstTokenInfo, not the 18 stub.
    expect(intent.executeRequirement.tokenApproval?.amount, 'approval display uses real decimals').toBe('100');
  });
});
