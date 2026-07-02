// Swap execution characterization — drives the REAL swap() flow and asserts every emitted
// on-chain call (source-swap, bridge/COT deposit, prefunding, destination-swap) by decoding
// calldata, call-by-call, against the decision graph. Mocks only injected deps; the aggregator
// echoes taker/receiver/amount into real SWAP calldata; the EOA wallet really signs.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Hex } from 'viem';

// Public-client reads are routed through a plain stub (mock createPublicClient). Everything else
// in viem (encoding, parseTransaction, custom, accounts) stays real, so wallet signing is genuine.
const hoisted = vi.hoisted(() => {
  const readContract = vi.fn();
  const getCode = vi.fn();
  const getTransactionCount = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const multicall = vi.fn();
  const createPublicClient = vi.fn((opts?: { chain?: unknown }) => ({
    chain: opts?.chain,
    readContract,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    multicall,
  }));
  return { readContract, getCode, getTransactionCount, waitForTransactionReceipt, multicall, createPublicClient };
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

// Mayan SWIFT route-data derivation needs a full vendor quote and can hit the network (getSwapEvm).
// Stub only that vendor encoder so the native-Mayan deposit path runs offline once routing allows it
// (see the it.fails spec below). Everything else from the module stays real.
vi.mock('@avail-project/nexus-types/rff', async () => {
  const actual = await vi.importActual<typeof import('@avail-project/nexus-types/rff')>(
    '@avail-project/nexus-types/rff'
  );
  return {
    ...actual,
    getRoutesDataFromQuote: vi.fn().mockResolvedValue({
      gasDrop: 0n,
      cancelFee: 0n,
      refundFee: 0n,
      random: ('0x' + '00'.repeat(32)) as `0x${string}`,
      swapProtocol: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      swapData: '0x' as `0x${string}`,
      middleToken: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      minMiddleAmount: 0n,
    }),
  };
});

import { swap as flowSwap } from '../../../src/flows/swap';
import { SwapMode, type FlatBalance } from '../../../src/swap/types';
import { EADDRESS } from '../../../src/swap/constants';
import {
  APPROVALS,
  bytes32Address,
  decodeEoaTx,
  dispatchedChains,
  EOA,
  EPH,
  EPH_ACCOUNT,
  expectCallSequence,
  makeCharChainList,
  makeCharMiddleware,
  makeRealEoaWallet,
  makeRequoteDrift,
  type RequoteDrift,
  PREDICTED_SAFE,
  readContractStub,
  rffRecipient,
  rffRequest,
  ROUTERS,
  safeBatchesForChain,
  sbcBatchesForChain,
  sbcCallOrderWith,
  SOURCE_DAI,
  VAULT_BY_CHAIN,
} from '../../helpers/swap-characterization';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  USDC_ARB,
  USDC_BASE,
  USDC_OP,
  WETH,
} from '../../helpers/swap';

const eq = (a: Hex) => (got: unknown) => expect((got as Hex).toLowerCase()).toBe(a.toLowerCase());

const installPublicClientStubs = () => {
  hoisted.readContract.mockImplementation(readContractStub);
  hoisted.getCode.mockResolvedValue(undefined);
  hoisted.getTransactionCount.mockResolvedValue(0n);
  hoisted.waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => ({
    status: 'success',
    transactionHash: hash,
  }));
  hoisted.multicall.mockImplementation(async ({ contracts }: { contracts: unknown[] }) =>
    contracts.map(() => ({ status: 'success', result: 0n }))
  );
};

// permit owner/spender sit at args[0]/args[1] for both EIP-2612 and DAI permit shapes.
const permitOwnerSpender = (owner: Hex, spender: Hex) => (args: readonly unknown[]) => {
  eq(owner)(args[0]);
  eq(spender)(args[1]);
};

describe('swap execution characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installPublicClientStubs();
  });

  it('EXACT_IN · Nexus · two 7702 sources → 7702 dst token swap', async () => {
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
      { amount: '1000', chainID: OP_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList(); // all chains 7702
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet, sentTxs } = makeRealEoaWallet();

    const input = {
      mode: SwapMode.EXACT_IN as const,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n },
          { chainId: OP_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH,
      },
    };

    const result = await flowSwap(
      input,
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    const X = 1000n * 10n ** 18n; // source input (literal)
    const srcOut = 1000n * 10n ** 6n; // bebop DAI→USDC @1 → 1000 USDC (literal)

    // ── per 7702 source chain: source-swap batch then bridge-deposit batch ──
    for (const [chainId, usdc] of [
      [ARB_CHAIN, USDC_ARB],
      [OP_CHAIN, USDC_OP],
    ] as const) {
      const batches = sbcBatchesForChain(middlewareClient, chainId);
      expect(batches.length, `chain ${chainId} SBC batch count`).toBe(2);
      const [source, bridge] = batches;

      // SOURCE_SWAP: fund EOA→EPH (permit+transferFrom), approve router, swap → receiver=EPH (wrapper)
      expectCallSequence(
        source,
        [
          { fn: 'permit', to: SOURCE_DAI, argsMatch: permitOwnerSpender(EOA, EPH) },
          { fn: 'transferFrom', to: SOURCE_DAI, argsMatch: (a) => { eq(EOA)(a[0]); eq(EPH)(a[1]); expect(a[2]).toBe(X); } },
          { fn: 'approve', to: SOURCE_DAI, argsMatch: (a) => { eq(APPROVALS.bebop)(a[0]); expect(a[1]).toBe(X); } },
          {
            fn: 'swap',
            to: ROUTERS.bebop,
            argsMatch: (a) => {
              eq(SOURCE_DAI)(a[0]); // inputToken
              eq(usdc)(a[1]); // outputToken
              expect(a[2]).toBe(X); // inputAmount
              expect(a[3]).toBe(srcOut); // outputAmount
              eq(EPH)(a[4]); // taker
              eq(EPH)(a[5]); // receiver = WRAPPER(chain)
            },
          },
        ],
        `src ${chainId}`
      );

      // PRE_BRIDGE_CALLS (Nexus 7702): no funding leg (swap funded EPH); approve→deposit. #86 Seam 1
      // bridges the actual wrapper COT (the full balance), so there is nothing left to sweep here.
      expectCallSequence(
        bridge,
        [
          { fn: 'approve', to: usdc, argsMatch: (a) => { eq(VAULT_BY_CHAIN[chainId])(a[0]); expect(a[1]).toBe(srcOut); } },
          { fn: 'deposit', to: VAULT_BY_CHAIN[chainId] },
        ],
        `bridge ${chainId}`
      );
    }

    // BRIDGE_RECEIVER = EPH (7702 dst + destination swap)
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EPH));

    // S3 — the signed RFF intent: each source bridges srcOut COT from its own chain/token; the
    // destination total is the summed COT delivered to the receiver (the dst swap runs after).
    const rff = rffRequest(middlewareClient);
    const usdcByChain: Record<number, Hex> = { [ARB_CHAIN]: USDC_ARB, [OP_CHAIN]: USDC_OP };
    expect(rff.sources.map((s) => Number(s.chain_id)).sort((a, b) => a - b)).toEqual([OP_CHAIN, ARB_CHAIN]);
    for (const s of rff.sources) {
      expect(BigInt(s.value), 'RFF source value == bridged COT').toBe(srcOut);
      // RFF carries token/recipient addresses as bytes32 (left-padded).
      expect(s.contract_address.toLowerCase()).toBe(bytes32Address(usdcByChain[Number(s.chain_id)]));
    }
    expect(rff.destinations[0].contract_address.toLowerCase()).toBe(bytes32Address(USDC_BASE));
    expect(BigInt(rff.destinations[0].value), 'RFF destination total == both sources').toBe(2n * srcOut);

    // S2 — Nexus deposits are submitted AFTER the RFF intent is registered (bridge.ts: RFF then SBC).
    expect(sbcCallOrderWith(middlewareClient, 'deposit')).toBeGreaterThan(
      middlewareClient.submitRFF.mock.invocationCallOrder[0]
    );

    // S5 — exactly the two source chains + the destination chain emit batches; nothing stray.
    expect(dispatchedChains(middlewareClient)).toEqual([OP_CHAIN, BASE_CHAIN, ARB_CHAIN].sort((a, b) => a - b));

    // ── DESTINATION_SWAP (BASE 7702): approve→swap(recv=EOA)→transfer(leftover COT → EOA) ──
    // #86: the unused COT is returned by ONE direct transfer (balance − consumed), replacing the blind
    // approve+Sweeper drain; the output token lands at the EOA so its dust sweep is skipped.
    const dstBatches = sbcBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dstBatches.length, 'dst SBC batch count').toBe(1);
    const [dst] = dstBatches;

    // Y is reclaim-sized; assert consistency (router approve == swap input) and Y ≤ bridged total.
    const swapCall = dst.find((c) => c.fn === 'swap')!;
    const approveRouterCall = dst.find((c) => c.fn === 'approve')!;
    const Y = approveRouterCall.args[1] as bigint;
    expect(swapCall.args[2]).toBe(Y); // approve amount == swap inputAmount
    expect(Y).toBeLessThanOrEqual(2n * srcOut); // ≤ bridged total

    expectCallSequence(
      dst,
      [
        { fn: 'approve', to: USDC_BASE, argsMatch: (a) => { eq(APPROVALS.bebop)(a[0]); } },
        {
          fn: 'swap',
          to: ROUTERS.bebop,
          argsMatch: (a) => {
            eq(USDC_BASE)(a[0]); // input = COT
            eq(WETH)(a[1]); // output = dst token
            eq(EPH)(a[4]); // taker = WRAPPER
            eq(EOA)(a[5]); // receiver = EOA
          },
        },
        { fn: 'transfer', to: USDC_BASE, argsMatch: (a) => { eq(EOA)(a[0]); } }, // leftover COT → EOA
      ],
      'dst'
    );

    // All-7702, no native: the EOA signed/sent nothing.
    expect(sentTxs).toHaveLength(0);
    expect(result.intentExplorerUrl).toMatch(/\/rff\//);
  });

  it('EXACT_IN · Nexus · COT-direct fast-path (no source/dst swap) → bridge recv=EOA', async () => {
    // USDC (=COT) held at the EOA, bridged to COT on the destination → no source swap, no dst swap.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 1000, name: 'USD Coin', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet, sentTxs } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 1000n * 10n ** 6n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE, // COT destination → no destination swap
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    const amt = 1000n * 10n ** 6n;

    // Single bridge batch on ARB (no source swap): fast-path funding (permit+transferFrom EOA→EPH),
    // then approve(vault)→deposit. #86 bridges the full wrapper balance → no sweep.
    const arb = sbcBatchesForChain(middlewareClient, ARB_CHAIN);
    expect(arb.length, 'ARB SBC batch count').toBe(1);
    expectCallSequence(
      arb[0],
      [
        { fn: 'permit', to: USDC_ARB, argsMatch: permitOwnerSpender(EOA, EPH) },
        { fn: 'transferFrom', to: USDC_ARB, argsMatch: (a) => { eq(EOA)(a[0]); eq(EPH)(a[1]); expect(a[2]).toBe(amt); } },
        { fn: 'approve', to: USDC_ARB, argsMatch: (a) => { eq(VAULT_BY_CHAIN[ARB_CHAIN])(a[0]); expect(a[1]).toBe(amt); } },
        { fn: 'deposit', to: VAULT_BY_CHAIN[ARB_CHAIN] },
      ],
      'arb fast-path bridge'
    );

    // No destination swap → BRIDGE_RECEIVER = EOA, and no destination SBC batch.
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
    expect(sbcBatchesForChain(middlewareClient, BASE_CHAIN).length, 'no dst batch').toBe(0);
    expect(sentTxs).toHaveLength(0);
  });

  it('EXACT_IN · Nexus · non-7702 Safe source → 7702 dst token swap', async () => {
    // OP is non-7702 → Safe wrapper. Source swap + bridge deposit dispatch via Safe.execTransaction
    // (captured at createSafeExecuteTx, decoded from MultiSend). Wrapper = predicted Safe.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: OP_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [OP_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet, sentTxs } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: OP_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    const X = 1000n * 10n ** 18n;
    const srcOut = 1000n * 10n ** 6n;

    // OP dispatches via Safe: [0] source swap, [1] bridge deposit.
    const opSafe = safeBatchesForChain(middlewareClient, OP_CHAIN);
    expect(opSafe.length, 'OP Safe batch count').toBe(2);

    // SOURCE_SWAP (Safe): fund EOA→SAFE, approve router, swap → receiver=SAFE (wrapper)
    expectCallSequence(
      opSafe[0],
      [
        { fn: 'permit', to: SOURCE_DAI, argsMatch: permitOwnerSpender(EOA, PREDICTED_SAFE) },
        { fn: 'transferFrom', to: SOURCE_DAI, argsMatch: (a) => { eq(EOA)(a[0]); eq(PREDICTED_SAFE)(a[1]); expect(a[2]).toBe(X); } },
        { fn: 'approve', to: SOURCE_DAI, argsMatch: (a) => { eq(APPROVALS.bebop)(a[0]); expect(a[1]).toBe(X); } },
        {
          fn: 'swap',
          to: ROUTERS.bebop,
          argsMatch: (a) => {
            eq(SOURCE_DAI)(a[0]);
            eq(USDC_OP)(a[1]);
            expect(a[2]).toBe(X);
            expect(a[3]).toBe(srcOut);
            eq(PREDICTED_SAFE)(a[4]); // taker = SAFE
            eq(PREDICTED_SAFE)(a[5]); // receiver = SAFE (wrapper)
          },
        },
      ],
      'OP source (safe)'
    );

    // PRE_BRIDGE_CALLS (Nexus Safe): COT already at SAFE (swap-sourced, no funding leg);
    // transfer SAFE→EPH, EPH permits the vault, deposit. #86 bridges the full balance → no sweep.
    expectCallSequence(
      opSafe[1],
      [
        { fn: 'transfer', to: USDC_OP, argsMatch: (a) => { eq(EPH)(a[0]); expect(a[1]).toBe(srcOut); } },
        { fn: 'permit', to: USDC_OP, argsMatch: (a) => { eq(EPH)(a[0]); eq(VAULT_BY_CHAIN[OP_CHAIN])(a[1]); expect(a[2]).toBe(srcOut); } },
        { fn: 'deposit', to: VAULT_BY_CHAIN[OP_CHAIN] },
      ],
      'OP bridge (safe)'
    );

    // BRIDGE_RECEIVER = EPH (7702 dst + dst swap); dst swap runs on BASE via Calibur SBC.
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EPH));
    const dst = sbcBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst.length, 'dst SBC batch count').toBe(1);
    const dstSwap = dst[0].find((c) => c.fn === 'swap')!;
    eq(EPH)(dstSwap.args[4]); // taker = wrapper
    eq(EOA)(dstSwap.args[5]); // receiver = EOA
    expect(dst[0].map((c) => c.fn)).toEqual(['approve', 'swap', 'transfer']);

    // No native legs → EOA signed nothing (Safe txs are middleware-sponsored).
    expect(sentTxs).toHaveLength(0);
  });

  it('EXACT_IN · Mayan · COT-direct 7702 → approve-only (no deposit/sweep), bridge recv=EOA', async () => {
    // Same inputs as the Nexus COT-direct case but forceMayan. The deposit batch stops at the vault
    // allowance — the middleware sponsors depositMayan() after the RFF. Pins the Nexus↔Mayan diff.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 1000, name: 'USD Coin', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'mayan' });
    const { wallet, sentTxs } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 1000n * 10n ** 6n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: true,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    const amt = 1000n * 10n ** 6n;

    // Mayan 7702 deposit batch = fund EOA→EPH + approve(vault). NO deposit, NO sweep.
    const arb = sbcBatchesForChain(middlewareClient, ARB_CHAIN);
    expect(arb.length, 'ARB Mayan SBC batch count').toBe(1);
    expectCallSequence(
      arb[0],
      [
        { fn: 'permit', to: USDC_ARB, argsMatch: permitOwnerSpender(EOA, EPH) },
        { fn: 'transferFrom', to: USDC_ARB, argsMatch: (a) => { eq(EOA)(a[0]); eq(EPH)(a[1]); expect(a[2]).toBe(amt); } },
        { fn: 'approve', to: USDC_ARB, argsMatch: (a) => { eq(VAULT_BY_CHAIN[ARB_CHAIN])(a[0]); expect(a[1]).toBe(amt); } },
      ],
      'arb mayan approve-only'
    );

    expect(middlewareClient.submitRFF).toHaveBeenCalledTimes(1);
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));

    // S3 — the Mayan RFF intent: the single source bridges exactly `amt` COT from ARB. (The
    // destination value is Mayan-quote-derived, not a clean literal, so only its token is pinned.)
    const rff = rffRequest(middlewareClient);
    expect(rff.sources).toHaveLength(1);
    expect(BigInt(rff.sources[0].value)).toBe(amt);
    expect(rff.sources[0].contract_address.toLowerCase()).toBe(bytes32Address(USDC_ARB));
    expect(rff.destinations[0].contract_address.toLowerCase()).toBe(bytes32Address(USDC_BASE));
    expect(BigInt(rff.destinations[0].value)).toBeGreaterThan(0n);

    // S2 — Mayan approves the vault BEFORE the RFF is registered (middleware sponsors depositMayan after).
    expect(sbcCallOrderWith(middlewareClient, 'approve')).toBeLessThan(
      middlewareClient.submitRFF.mock.invocationCallOrder[0]
    );

    // S5 — only the source chain emits a batch (COT-direct dst, recv=EOA → no destination batch).
    expect(dispatchedChains(middlewareClient)).toEqual([ARB_CHAIN]);
    expect(sentTxs).toHaveLength(0);
  });

  it('EXACT_OUT · Nexus · 7702 source → COT dst (derived amounts, per-leg consistency)', async () => {
    // EXACT_OUT: ask for exactly N USDC on BASE. Source amounts are routing-derived, so we assert
    // the call SHAPE + receivers exactly and the amounts for CONSISTENCY across a leg (the same
    // value threads permit→transferFrom→approve→swap-input; swap-output == bridge approve/deposit).
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_OUT as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE, // COT destination → no dst swap
          toAmountRaw: 500n * 10n ** 6n,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    const [source, bridge] = sbcBatchesForChain(middlewareClient, ARB_CHAIN);

    // SOURCE_SWAP shape + receivers exact; amounts consistent (derived value used throughout the leg).
    expect(source.map((c) => c.fn)).toEqual(['permit', 'transferFrom', 'approve', 'swap']);
    const dIn = source[1].args[2] as bigint; // transferFrom amount = DAI input
    expect(source[3].args[2]).toBe(dIn); // swap inputAmount == DAI funded
    eq(SOURCE_DAI)(source[3].args[0]);
    eq(USDC_ARB)(source[3].args[1]);
    eq(EPH)(source[3].args[4]); // taker = wrapper
    eq(EPH)(source[3].args[5]); // receiver = wrapper (cross-chain leg)
    const usdcOut = source[3].args[3] as bigint; // swap outputAmount (USDC)

    // BRIDGE deposit: approve(vault) + deposit + sweep; approve amount == produced COT.
    expect(bridge.map((c) => c.fn)).toEqual(['approve', 'deposit']);
    eq(VAULT_BY_CHAIN[ARB_CHAIN])(bridge[0].args[0]);
    expect(bridge[0].args[1]).toBe(usdcOut); // vault approve == swap output (full produced COT)

    // No dst swap (COT destination) → BRIDGE_RECEIVER = EOA, no dst batch.
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
    expect(sbcBatchesForChain(middlewareClient, BASE_CHAIN).length).toBe(0);
  });

  it('EXACT_IN · Nexus · native source swap (EOA really signs+sends) → COT dst', async () => {
    // Native ETH source on a 7702 chain: the source swap is EOA-submitted (Calibur execute{value}),
    // so it exercises REAL encode+sign+broadcast. We decode it back out of the captured raw tx.
    const balances: FlatBalance[] = [
      { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS as Hex, value: 2500, name: 'ETH', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet, sentTxs } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: EADDRESS as Hex, amountRaw: 1n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE, // COT destination → no dst swap
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    const ethIn = 1n * 10n ** 18n;
    const usdcOut = 2500n * 10n ** 6n; // 1 ETH @ 2500

    // The EOA really signed and "sent" exactly one tx — the native source swap. Decode it back out:
    // a Calibur execute wrapping the single SWAP, value carried inline, no funding/approve.
    expect(sentTxs).toHaveLength(1);
    const eoa = decodeEoaTx(sentTxs[0].raw);
    expect(eoa.value).toBe(ethIn); // native carried by the outer tx
    expect(eoa.calls.map((c) => c.fn)).toEqual(['swap']);
    const swp = eoa.calls[0];
    eq(EADDRESS as Hex)(swp.args[0]); // inputToken = native
    eq(USDC_ARB)(swp.args[1]); // outputToken = COT
    expect(swp.args[2]).toBe(ethIn);
    expect(swp.args[3]).toBe(usdcOut);
    eq(EPH)(swp.args[4]); // taker = wrapper
    eq(EPH)(swp.args[5]); // receiver = wrapper
    expect(swp.value).toBe(ethIn); // native pulled by the swap

    // Bridge deposit (bootstrap SBC filtered): approve(vault, produced COT)→deposit. #86 bridges the
    // full wrapper balance → no sweep.
    const arb = sbcBatchesForChain(middlewareClient, ARB_CHAIN);
    expect(arb.length, 'ARB bridge batch (bootstrap filtered)').toBe(1);
    expectCallSequence(
      arb[0],
      [
        { fn: 'approve', to: USDC_ARB, argsMatch: (a) => { eq(VAULT_BY_CHAIN[ARB_CHAIN])(a[0]); expect(a[1]).toBe(usdcOut); } },
        { fn: 'deposit', to: VAULT_BY_CHAIN[ARB_CHAIN] },
      ],
      'arb native bridge'
    );

    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
  });

  it('EXACT_OUT · Nexus · COT dst + native gas → gas swap (COT→native, taker=wrapper, recv=EOA)', async () => {
    // Gas top-up is EXACT_OUT-only (EXACT_IN always sets gasSwap=null). toToken==COT so there is no
    // token swap — only the gas swap. Because a dst swap (the gas swap) exists, BRIDGE_RECEIVER=EPH,
    // and the gas swap is quoted/executed on the wrapper (taker=EPH) delivering native to the EOA.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 1000, name: 'USD Coin', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_OUT as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE, // COT → no token swap
          toAmountRaw: 500n * 10n ** 6n,
          toNativeAmountRaw: 1n * 10n ** 16n, // 0.01 ETH gas top-up
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // Gas swap present → BRIDGE_RECEIVER = EPH (wrapper runs the dst gas swap).
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EPH));

    // Destination batch is the gas swap (COT→native): approve(router)→swap(taker=EPH, recv=EOA)→
    // transfer leftover COT → EOA. No token swap, no native sweep (native delivered straight to the EOA).
    const dst = sbcBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst.length, 'dst SBC batch count').toBe(1);
    const gasSwap = dst[0].find((c) => c.fn === 'swap')!;
    eq(USDC_BASE)(gasSwap.args[0]); // input = COT
    eq(EADDRESS as Hex)(gasSwap.args[1]); // output = native
    eq(EPH)(gasSwap.args[4]); // taker = wrapper (needsTokenSwap||needsGasSwap → wrapper)
    eq(EOA)(gasSwap.args[5]); // receiver = EOA
    // #86: leftover COT returned by one direct transfer → EOA (not a Sweeper drain), native direct.
    expect(dst[0].map((c) => c.fn)).toEqual(['approve', 'swap', 'transfer']);
    const refund = dst[0].find((c) => c.fn === 'transfer')!;
    eq(USDC_BASE)(refund.to);
    eq(EOA)(refund.args[0]);
  });

  it('EXACT_IN · Nexus · 7702 source → non-7702 Safe destination swap (recv=SAFE, direct output)', async () => {
    // Destination chain is non-7702 → Safe wrapper. Bridge fills the predicted Safe; the dst swap
    // runs via Safe.execTransaction and delivers WETH straight to the EOA (NO output sweep, unlike 7702).
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [BASE_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // Source + bridge on ARB are 7702 (SBC); only the destination is Safe.
    expect(sbcBatchesForChain(middlewareClient, ARB_CHAIN).length).toBe(2);

    // BRIDGE_RECEIVER = predicted Safe (non-7702 dst + dst swap).
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(PREDICTED_SAFE));

    // Destination swap via Safe.execTransaction (no funding — bridge filled the Safe):
    // approve(router)→swap(taker=SAFE, recv=EOA)→transfer leftover COT → EOA. No WETH output sweep
    // (Safe delivers output direct to the EOA).
    const dst = safeBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst.length, 'dst Safe batch count').toBe(1);
    expect(dst[0].map((c) => c.fn)).toEqual(['approve', 'swap', 'transfer']);
    const swp = dst[0][1];
    eq(USDC_BASE)(swp.args[0]);
    eq(WETH)(swp.args[1]);
    eq(PREDICTED_SAFE)(swp.args[4]); // taker = Safe wrapper
    eq(EOA)(swp.args[5]); // receiver = EOA
    eq(USDC_BASE)(dst[0][2].to); // leftover COT transferred to the EOA
  });

  it('EXACT_IN · Nexus · same-chain-as-dst COT → dst swap, no bridge (handoff)', async () => {
    // COT held on the destination chain itself → no bridge. The COT is handed EOA→wrapper and the
    // dst swap runs locally. Source receiver collapses to the handoff; RFF is never submitted.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 1000, name: 'USD Coin', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 1000n * 10n ** 6n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // No bridge at all.
    expect(middlewareClient.submitRFF).not.toHaveBeenCalled();

    // Single BASE batch: fund EOA→EPH (handoff), then the dst swap. No bridge → no surplus, the swap
    // consumes the full handed-off COT, so there is no leftover to transfer.
    const base = sbcBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(base.length).toBe(1);
    expect(base[0].map((c) => c.fn)).toEqual(['permit', 'transferFrom', 'approve', 'swap']);
    permitOwnerSpender(EOA, EPH)(base[0][0].args);
    eq(EPH)(base[0][1].args[1]); // transferFrom EOA→EPH
    const swp = base[0][3];
    eq(USDC_BASE)(swp.args[0]);
    eq(WETH)(swp.args[1]);
    eq(EPH)(swp.args[4]); // taker = wrapper
    eq(EOA)(swp.args[5]); // receiver = EOA
    // funding/approve/swap input all consistent.
    const fundAmt = base[0][1].args[2] as bigint;
    expect(base[0][2].args[1]).toBe(fundAmt); // approve(router) == funded
    expect(swp.args[2]).toBe(fundAmt); // swap input == funded
  });

  it('EXACT_IN · Nexus · mixed native + ERC20 sources → COT dst', async () => {
    // One native source (EOA-submitted swap) + one ERC20 source (SBC swap) in the same flow → both
    // bridged. Exercises the two source dispatch paths together.
    const balances: FlatBalance[] = [
      { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS as Hex, value: 2500, name: 'ETH', logo: '' },
      { amount: '1000', chainID: OP_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet, sentTxs } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [
            { chainId: ARB_CHAIN, tokenAddress: EADDRESS as Hex, amountRaw: 1n * 10n ** 18n },
            { chainId: OP_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n },
          ],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE, // COT → no dst swap
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // Native ARB source swap = the only EOA-signed tx; ERC20 OP source swap = an SBC.
    expect(sentTxs).toHaveLength(1);
    const nativeSwap = decodeEoaTx(sentTxs[0].raw);
    expect(nativeSwap.calls.map((c) => c.fn)).toEqual(['swap']);
    eq(EADDRESS as Hex)(nativeSwap.calls[0].args[0]);
    eq(USDC_ARB)(nativeSwap.calls[0].args[1]);
    eq(EPH)(nativeSwap.calls[0].args[5]); // receiver = wrapper

    // ARB: only a bridge SBC (native swap went via EOA). OP: source-swap SBC + bridge SBC.
    expect(sbcBatchesForChain(middlewareClient, ARB_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['approve', 'deposit'],
    ]);
    const op = sbcBatchesForChain(middlewareClient, OP_CHAIN);
    expect(op.length).toBe(2);
    expect(op[0].map((c) => c.fn)).toEqual(['permit', 'transferFrom', 'approve', 'swap']); // DAI source swap
    expect(op[1].map((c) => c.fn)).toEqual(['approve', 'deposit']); // bridge

    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
  });

  it('EXACT_IN · Mayan · Safe source swap → COT dst (transfer+permit, no deposit/sweep)', async () => {
    // Non-7702 Mayan: the Safe source swap dispatches via execTransaction, and the Mayan deposit
    // batch stops at SAFE→EPH transfer + EPH→vault permit (middleware sponsors depositMayan).
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: OP_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [OP_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'mayan' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: OP_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: true,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    const op = safeBatchesForChain(middlewareClient, OP_CHAIN);
    expect(op.length, 'OP Safe batch count').toBe(2);
    // [0] source swap (DAI→USDC, receiver=SAFE)
    expect(op[0].map((c) => c.fn)).toEqual(['permit', 'transferFrom', 'approve', 'swap']);
    eq(PREDICTED_SAFE)(op[0][3].args[5]);
    // [1] Mayan deposit = transfer SAFE→EPH + EPH→vault permit. NO deposit, NO sweep.
    expect(op[1].map((c) => c.fn)).toEqual(['transfer', 'permit']);
    eq(EPH)(op[1][0].args[0]); // transfer to EPH
    eq(EPH)(op[1][1].args[0]); // permit owner = EPH
    eq(VAULT_BY_CHAIN[OP_CHAIN])(op[1][1].args[1]); // permit spender = vault
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
  });

  it('EXACT_OUT · Nexus · 7702 source → 7702 dst token swap (exact output is a literal)', async () => {
    // EXACT_OUT to a non-COT token: the destination swap delivers EXACTLY the requested output, so we
    // assert that output as a literal (inputs stay derived/consistency-checked).
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    const wantWeth = 2n * 10n ** 17n; // exactly 0.2 WETH out
    await flowSwap(
      {
        mode: SwapMode.EXACT_OUT as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
          toAmountRaw: wantWeth,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EPH));
    const dst = sbcBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst[0].map((c) => c.fn)).toEqual(['approve', 'swap', 'transfer']);
    const swp = dst[0][1];
    eq(USDC_BASE)(swp.args[0]);
    eq(WETH)(swp.args[1]);
    expect(swp.args[3]).toBe(wantWeth); // EXACT_OUT → output is exactly the requested amount
    eq(EPH)(swp.args[4]);
    eq(EOA)(swp.args[5]);

    // S6 — EXACT_OUT source/bridge amounts are derived (no clean literal), so pin them as an
    // observable chain across every seam: source-swap COT output == COT approved to the vault == RFF
    // source value (all the bridged amount); the dst swap consumes ≤ that total to deliver wantWeth.
    const src = sbcBatchesForChain(middlewareClient, ARB_CHAIN);
    const cotOut = src[0].find((c) => c.fn === 'swap')!.args[3] as bigint; // DAI→USDC produced
    const vaultApprove = src[1].find(
      (c) => c.fn === 'approve' && (c.args[0] as Hex).toLowerCase() === VAULT_BY_CHAIN[ARB_CHAIN].toLowerCase()
    )!;
    expect(vaultApprove.args[1], 'vault approve == swapped COT').toBe(cotOut);
    expect(BigInt(rffRequest(middlewareClient).sources[0].value), 'RFF bridges exactly the swapped COT').toBe(cotOut);
    expect(swp.args[2] as bigint, 'dst-swap input ≤ bridged total').toBeLessThanOrEqual(cotOut);

    // S5 — exactly the source + destination chains emit batches; nothing stray.
    expect(dispatchedChains(middlewareClient)).toEqual([BASE_CHAIN, ARB_CHAIN].sort((a, b) => a - b));
  });

  it('EXACT_OUT · Mayan · 7702 source swap → COT dst (approve-only)', async () => {
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'mayan' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_OUT as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE,
          toAmountRaw: 500n * 10n ** 6n,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: true,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    const arb = sbcBatchesForChain(middlewareClient, ARB_CHAIN);
    expect(arb.length).toBe(2); // [0] source swap, [1] Mayan approve-only
    expect(arb[0].map((c) => c.fn)).toEqual(['permit', 'transferFrom', 'approve', 'swap']);
    expect(arb[1].map((c) => c.fn)).toEqual(['approve']); // approve(vault) only — no deposit/sweep
    eq(VAULT_BY_CHAIN[ARB_CHAIN])(arb[1][0].args[0]);
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
  });

  it('EXACT_IN · Mayan · native same-token bridge → EOA-submitted depositMayan{value} + report', async () => {
    // Native ETH bridged same-token via Mayan: native participates in provider selection like any
    // token (route.ts:1177), so forceMayan routes it through Mayan. No ERC-20 approve, no SBC deposit
    // — the EOA submits a payable depositMayan itself (it can't be sponsored) and reports the tx.
    const balances: FlatBalance[] = [
      { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS as Hex, value: 2500, name: 'ETH', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'mayan' });
    const { wallet, sentTxs } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: EADDRESS as Hex, amountRaw: 1n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: EADDRESS as Hex, // native → same-token bridge
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: true,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // The EOA really signed one tx: the payable depositMayan (Calibur execute{value}). Decode it out.
    expect(sentTxs).toHaveLength(1);
    const dep = decodeEoaTx(sentTxs[0].raw);
    expect(dep.value).toBe(1n * 10n ** 18n);
    expect(dep.calls.map((c) => c.fn)).toEqual(['depositMayan']);
    eq(VAULT_BY_CHAIN[ARB_CHAIN])(dep.calls[0].to);
    expect(dep.calls[0].value).toBe(1n * 10n ** 18n);

    // S4 — decode the depositMayan RFF struct (only routeData is stubbed; the intent is real). The
    // bridged source carries the native amount on ARB; recipient is the EOA (same-token → no dst swap).
    const ZERO32 = ('0x' + '0'.repeat(64)) as Hex;
    const deposit = dep.calls[0].args[0] as {
      sources: { chainID: bigint; contractAddress: Hex; value: bigint }[];
      destinationChainID: bigint;
      recipientAddress: Hex;
    };
    expect(deposit.sources).toHaveLength(1);
    expect(deposit.sources[0].value, 'bridged native == tx value').toBe(1n * 10n ** 18n);
    expect(deposit.sources[0].chainID).toBe(BigInt(ARB_CHAIN));
    expect(deposit.sources[0].contractAddress.toLowerCase()).toBe(ZERO32); // native normalized to zero
    expect(deposit.recipientAddress.toLowerCase()).toBe(bytes32Address(EOA)); // same-token native → recv=EOA
    expect(deposit.destinationChainID).toBe(BigInt(BASE_CHAIN));

    // RFF submitted, the native tx reported, and NO ERC-20 approve SBC (all-native).
    expect(middlewareClient.submitRFF).toHaveBeenCalledTimes(1);
    expect(middlewareClient.reportMayanNativeTx).toHaveBeenCalledTimes(1);
    // S2 — the native deposit is reported to the middleware AFTER the RFF is registered (bridge.ts).
    expect(middlewareClient.reportMayanNativeTx.mock.invocationCallOrder[0]).toBeGreaterThan(
      middlewareClient.submitRFF.mock.invocationCallOrder[0]
    );
    expect(sbcBatchesForChain(middlewareClient, ARB_CHAIN).length).toBe(0);
  });

  it('EXACT_IN · Mayan · mixed native + ERC20 sources → COT dst (approve-only legs)', async () => {
    // Native source is swapped to USDC (EOA-signed) and ERC20 source swapped via SBC; both bridged
    // tokens are then ERC-20 USDC, so each leg is a Mayan approve-only batch (no native depositMayan).
    const balances: FlatBalance[] = [
      { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS as Hex, value: 2500, name: 'ETH', logo: '' },
      { amount: '1000', chainID: OP_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'mayan' });
    const { wallet, sentTxs } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [
            { chainId: ARB_CHAIN, tokenAddress: EADDRESS as Hex, amountRaw: 1n * 10n ** 18n },
            { chainId: OP_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n },
          ],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: true,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // Native ARB swap = the only EOA-signed tx; its bridged USDC is an ERC-20 Mayan approve leg.
    expect(sentTxs).toHaveLength(1);
    expect(decodeEoaTx(sentTxs[0].raw).calls.map((c) => c.fn)).toEqual(['swap']);
    expect(sbcBatchesForChain(middlewareClient, ARB_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['approve'], // Mayan approve(vault) — no deposit/sweep
    ]);
    expect(sbcBatchesForChain(middlewareClient, OP_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['permit', 'transferFrom', 'approve', 'swap'], // ERC20 source swap
      ['approve'], // Mayan approve(vault)
    ]);
    expect(middlewareClient.reportMayanNativeTx).not.toHaveBeenCalled();
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
  });

  it('EXACT_IN · Nexus · mixed-wrapper sources (7702 + non-7702 Safe) → 7702 dst swap', async () => {
    // One 7702 source (ARB, SBC) and one non-7702 source (OP, Safe) in the same flow, both swapped
    // and bridged, then a 7702 destination swap. Exercises both source dispatch paths together.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
      { amount: '1000', chainID: OP_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [OP_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [
            { chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n },
            { chainId: OP_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n },
          ],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // ARB (7702) via SBC: source swap (recv=EPH) + bridge deposit.
    expect(sbcBatchesForChain(middlewareClient, ARB_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['permit', 'transferFrom', 'approve', 'swap'],
      ['approve', 'deposit'],
    ]);
    eq(EPH)(sbcBatchesForChain(middlewareClient, ARB_CHAIN)[0][3].args[5]);
    // OP (non-7702) via Safe: source swap (recv=SAFE) + bridge (transfer→permit→deposit→sweep).
    const opSafe = safeBatchesForChain(middlewareClient, OP_CHAIN);
    expect(opSafe.map((b) => b.map((c) => c.fn))).toEqual([
      ['permit', 'transferFrom', 'approve', 'swap'],
      ['transfer', 'permit', 'deposit'],
    ]);
    eq(PREDICTED_SAFE)(opSafe[0][3].args[5]);
    // 7702 destination swap; bridge recv = EPH.
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EPH));
    expect(sbcBatchesForChain(middlewareClient, BASE_CHAIN).length).toBe(1);
  });

  it('EXACT_IN · Mayan · mixed-wrapper sources (7702 + non-7702 Safe) → COT dst (approve-only)', async () => {
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
      { amount: '1000', chainID: OP_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [OP_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'mayan' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [
            { chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n },
            { chainId: OP_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n },
          ],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: true,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // 7702 source → SBC swap + Mayan approve(vault). Non-7702 source → Safe swap + Mayan transfer+permit.
    expect(sbcBatchesForChain(middlewareClient, ARB_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['permit', 'transferFrom', 'approve', 'swap'],
      ['approve'],
    ]);
    expect(safeBatchesForChain(middlewareClient, OP_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['permit', 'transferFrom', 'approve', 'swap'],
      ['transfer', 'permit'],
    ]);
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
  });

  it('EXACT_IN · Nexus · non-7702 destination + COT (no dst swap) → recv=EOA, no Safe involvement', async () => {
    // Without a destination swap the dst chain's 7702-ness is irrelevant: bridge fills the EOA
    // directly, no dst wrapper (Safe) is touched.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [BASE_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE, // COT → no dst swap
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
    expect(safeBatchesForChain(middlewareClient, BASE_CHAIN).length).toBe(0);
    expect(sbcBatchesForChain(middlewareClient, BASE_CHAIN).length).toBe(0);
  });

  it('EXACT_IN · Mayan · 7702 source → non-7702 Safe destination swap (recv=SAFE)', async () => {
    // Mayan bridge + a non-7702 destination swap: bridge recipient is the predicted Safe; the dst
    // swap runs via Safe.execTransaction. Pairs the Mayan provider with the Safe-destination branch.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [BASE_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'mayan' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: true,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // ARB (7702): source swap + Mayan approve(vault) only.
    expect(sbcBatchesForChain(middlewareClient, ARB_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['permit', 'transferFrom', 'approve', 'swap'],
      ['approve'],
    ]);
    // BRIDGE_RECEIVER = Safe; destination swap runs via Safe.execTransaction (recv=EOA, direct output).
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(PREDICTED_SAFE));
    const dst = safeBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst.length).toBe(1);
    expect(dst[0].map((c) => c.fn)).toEqual(['approve', 'swap', 'transfer']);
    eq(PREDICTED_SAFE)(dst[0][1].args[4]); // taker = Safe
    eq(EOA)(dst[0][1].args[5]); // receiver = EOA
  });

  it('EXACT_IN · Mayan · 7702 source → 7702 dst token swap (bridge recv=EPH)', async () => {
    // The missing provider×receiver cell: Mayan bridge fills the EPH wrapper on a 7702 destination,
    // then the dst token swap runs on the ephemeral via Calibur SBC (recv=EOA + output sweep).
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'mayan' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: true,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // ARB (7702): source swap + Mayan approve(vault) only.
    expect(sbcBatchesForChain(middlewareClient, ARB_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['permit', 'transferFrom', 'approve', 'swap'],
      ['approve'],
    ]);
    // BRIDGE_RECEIVER = EPH (7702 dst + dst swap). Dst swap runs on the ephemeral (7702 → output sweep).
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EPH));
    const dst = sbcBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst.length).toBe(1);
    expect(dst[0].map((c) => c.fn)).toEqual(['approve', 'swap', 'transfer']);
    eq(EPH)(dst[0][1].args[4]); // taker = EPH
    eq(EOA)(dst[0][1].args[5]); // receiver = EOA
    eq(USDC_BASE)(dst[0][2].to); // leftover COT transferred to the EOA (output WETH delivered direct)
  });

  it('EXACT_OUT · Nexus · token swap + gas in the same destination batch (7702 dst)', async () => {
    // Non-COT token AND a native gas top-up → the dst batch carries BOTH swaps: token swap then gas
    // swap, then output + COT-dust sweeps. Pins the combined destination shape.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList();
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_OUT as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
          toAmountRaw: 2n * 10n ** 17n, // 0.2 WETH
          toNativeAmountRaw: 1n * 10n ** 16n, // 0.01 ETH gas
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EPH));
    const dst = sbcBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst.length).toBe(1);
    // token swap (USDC→WETH) then gas swap (USDC→native), then ONE leftover COT transfer (both outputs
    // delivered direct to the EOA → no output sweeps).
    expect(dst[0].map((c) => c.fn)).toEqual(['approve', 'swap', 'approve', 'swap', 'transfer']);
    eq(WETH)(dst[0][1].args[1]); // token swap output = WETH
    expect(dst[0][1].args[3]).toBe(2n * 10n ** 17n); // EXACT_OUT → exactly 0.2 WETH
    eq(EADDRESS as Hex)(dst[0][3].args[1]); // gas swap output = native
    eq(EOA)(dst[0][1].args[5]);
    eq(EOA)(dst[0][3].args[5]);
  });

  it('EXACT_OUT · Nexus · gas swap on a non-7702 Safe destination (recv=SAFE)', async () => {
    // COT dst + native gas on a non-7702 chain → the gas swap runs via Safe.execTransaction; bridge
    // recipient is the Safe.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [BASE_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_OUT as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE, // COT → no token swap
          toAmountRaw: 500n * 10n ** 6n,
          toNativeAmountRaw: 1n * 10n ** 16n,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(PREDICTED_SAFE));
    const dst = safeBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst.length).toBe(1);
    expect(dst[0].map((c) => c.fn)).toEqual(['approve', 'swap', 'transfer']);
    eq(USDC_BASE)(dst[0][1].args[0]); // gas swap input = COT
    eq(EADDRESS as Hex)(dst[0][1].args[1]); // output = native
    eq(PREDICTED_SAFE)(dst[0][1].args[4]); // taker = Safe
    eq(EOA)(dst[0][1].args[5]);
    eq(USDC_BASE)(dst[0][2].to); // leftover COT transferred to the EOA
  });

  it('EXACT_IN · Nexus · Safe COT-direct fast-path (no source swap) → bridge recv=EOA', async () => {
    // COT at the EOA on a non-7702 chain → no source swap, Safe bridge with the fast-path funding leg:
    // EOA→Safe (permit+transferFrom), then Safe→EPH transfer + EPH→vault permit + deposit (#86: no sweep).
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: OP_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_OP, value: 1000, name: 'USD Coin', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [OP_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: OP_CHAIN, tokenAddress: USDC_OP, amountRaw: 1000n * 10n ** 6n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    const op = safeBatchesForChain(middlewareClient, OP_CHAIN);
    expect(op.length).toBe(1); // single bridge batch (no source swap)
    expect(op[0].map((c) => c.fn)).toEqual([
      'permit', 'transferFrom', 'transfer', 'permit', 'deposit',
    ]);
    permitOwnerSpender(EOA, PREDICTED_SAFE)(op[0][0].args); // fund EOA→Safe
    eq(PREDICTED_SAFE)(op[0][1].args[1]);
    eq(EPH)(op[0][2].args[0]); // Safe→EPH transfer
    eq(EPH)(op[0][3].args[0]); // EPH permits vault
    eq(VAULT_BY_CHAIN[OP_CHAIN])(op[0][3].args[1]);
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EOA));
  });

  it('EXACT_IN · Nexus · non-7702 Safe source → non-7702 Safe destination swap', async () => {
    // Both source and destination are non-7702: source swap + bridge via Safe on OP, dst swap via
    // Safe on BASE. Two independent Safe wrappers in one flow; recv=SAFE.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: OP_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [OP_CHAIN, BASE_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    await flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: OP_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // OP (Safe): source swap (recv=SAFE) + bridge.
    expect(safeBatchesForChain(middlewareClient, OP_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['permit', 'transferFrom', 'approve', 'swap'],
      ['transfer', 'permit', 'deposit'],
    ]);
    // BASE (Safe): destination swap (recv=SAFE bridge fill → swap recv=EOA).
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(PREDICTED_SAFE));
    const dst = safeBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst.length).toBe(1);
    expect(dst[0].map((c) => c.fn)).toEqual(['approve', 'swap', 'transfer']);
    eq(PREDICTED_SAFE)(dst[0][1].args[4]);
    eq(EOA)(dst[0][1].args[5]);
  });

  it('EXACT_OUT · Nexus · non-7702 Safe source → 7702 dst token swap (exact output)', async () => {
    // EXACT_OUT with a Safe source: source amounts are routing-derived, output is exact.
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: OP_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const chainList = makeCharChainList({ non7702: [OP_CHAIN] });
    const middlewareClient = makeCharMiddleware({ balances, provider: 'nexus' });
    const { wallet } = makeRealEoaWallet();

    const wantWeth = 2n * 10n ** 17n;
    await flowSwap(
      {
        mode: SwapMode.EXACT_OUT as const,
        data: {
          sources: [{ chainId: OP_CHAIN, tokenAddress: SOURCE_DAI }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
          toAmountRaw: wantWeth,
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );

    // Safe source swap + bridge.
    expect(safeBatchesForChain(middlewareClient, OP_CHAIN).map((b) => b.map((c) => c.fn))).toEqual([
      ['permit', 'transferFrom', 'approve', 'swap'],
      ['transfer', 'permit', 'deposit'],
    ]);
    // 7702 destination swap delivers exactly the requested WETH.
    expect(rffRecipient(middlewareClient)).toBe(bytes32Address(EPH));
    const dst = sbcBatchesForChain(middlewareClient, BASE_CHAIN);
    expect(dst[0].find((c) => c.fn === 'swap')!.args[3]).toBe(wantWeth);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Overarching amount-flow under a SOURCE DRIFT (the §1 dependency chain). The suite above is
// deterministic — executed == route estimate — and pins per-call EXECUTION wire format. These
// scenarios induce the one missing thing, executed ≠ planned, and assert the WHOLE chain re-aligns.
//
// There are TWO independent drift levers (see ai-requote-characterization-plan.md F2):
//   • balanceOf (the COT that ACTUALLY lands at the wrapper). Post-#84 the EXACT_IN reclaim bridges
//     this, NOT the quote — so it is the lever for the BRIDGE amount, the Nexus destination
//     re-derivation, and the Mayan refresh / value-match. Realized positive slippage = balanceOf > the
//     quote's minReceived floor. (The global harness stubs balanceOf=0, which zeroes the reclaim'd
//     bridge — F1 — so each scenario self-provides a realistic wrapper balance.)
//   • the requote (a failed source dispatch → requoteFailedChains). Its re-quoted quote.output feeds
//     ONLY the pooled-buffer guard (Σnew ≥ Σold − srcBuffer); the dispatched calldata is reused from
//     the prepared cache (F2.1), so the requote drives abort-vs-tolerate, not the bridged amount.
// All of requoteFailedChains, the guard, mergeBridgeAssets, the Nexus re-derivation, and
// refreshMayanQuotesForExecution run UNMOCKED; only the external edges (balanceOf, tx dispatch, the
// aggregator rate) are fed.
// ────────────────────────────────────────────────────────────────────────────
describe('amount flow under a source drift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installPublicClientStubs();
  });

  const PLANNED = 1000n * 10n ** 6n; // bebop DAI→USDC @1 → 1000 USDC quoted output / minReceived floor (P)
  const SLIPPED_UP = 1001n * 10n ** 6n; // the COT that ACTUALLY lands (positive slippage), A > P

  // Make balanceOf(COT, wrapper) return the COT the source swap really produced — the on-chain truth
  // the reclaim bridges. The global stub returns 0 (F1); a realistic per-scenario balance is the
  // faithful fix AND the bridge-amount drift lever. Keyed by token so the dst wrapper (≠ ARB COT)
  // stays 0 and its reclaim is skipped.
  const installWrapperCot = (rawByToken: Record<string, bigint>) => {
    hoisted.readContract.mockImplementation(async (req: { address: Hex; functionName: string }) =>
      req.functionName === 'balanceOf' ? (rawByToken[req.address.toLowerCase()] ?? 0n) : readContractStub(req)
    );
  };

  const runExactIn = (opts: {
    provider: 'nexus' | 'mayan';
    toTokenAddress: Hex;
    wrapperCot: bigint; // realistic balanceOf(USDC_ARB) at the source wrapper = produced COT
    drift?: RequoteDrift; // optional dispatch-fail + re-quote (drives only the buffer guard)
  }) => {
    installWrapperCot({ [USDC_ARB.toLowerCase()]: opts.wrapperCot });
    const balances: FlatBalance[] = [
      { amount: '1000', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: SOURCE_DAI, value: 1000, name: 'DAI', logo: '' },
    ];
    const middlewareClient = makeCharMiddleware({ balances, provider: opts.provider, drift: opts.drift });
    const { wallet, sentTxs } = makeRealEoaWallet();
    const promise = flowSwap(
      {
        mode: SwapMode.EXACT_IN as const,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI, amountRaw: 1000n * 10n ** 18n }],
          toChainId: BASE_CHAIN,
          toTokenAddress: opts.toTokenAddress,
        },
      },
      {
        chainList: makeCharChainList(),
        intentExplorerUrl: 'https://intent.example',
        evm: { walletClient: wallet, address: EOA },
        forceMayan: false,
        middlewareClient,
        swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
      },
      { onIntent: (d: { allow: () => void }) => d.allow() }
    );
    return { promise, middlewareClient, sentTxs };
  };

  // Count of source-swap batches on ARB: 1 without a requote, 2 with (attempt-0 + re-dispatch).
  const sourceSwapCount = (mw: ReturnType<typeof makeCharMiddleware>) =>
    sbcBatchesForChain(mw, ARB_CHAIN).filter((b) => b.some((c) => c.fn === 'swap')).length;

  // COT the bridge actually deposits = the vault approve amount. The approve call's `to` is the COT
  // token; the vault is the SPENDER (args[0]), so match on that.
  const vaultApprovedCot = (mw: ReturnType<typeof makeCharMiddleware>) => {
    const bridge = sbcBatchesForChain(mw, ARB_CHAIN).find((b) => b.some((c) => c.fn === 'deposit'))!;
    return bridge.find(
      (c) => c.fn === 'approve' && (c.args[0] as Hex).toLowerCase() === VAULT_BY_CHAIN[ARB_CHAIN].toLowerCase()
    )!.args[1] as bigint;
  };

  // ── balanceOf lever: the bridge tracks what ACTUALLY landed, not the quote floor ──

  it('no drift (baseline) · EXACT_IN · Nexus — bridge & RFF == produced COT (P)', async () => {
    const { promise, middlewareClient: mw } = runExactIn({ provider: 'nexus', toTokenAddress: USDC_BASE, wrapperCot: PLANNED });
    await promise;

    expect(sourceSwapCount(mw), 'no retry').toBe(1);
    expect(vaultApprovedCot(mw), 'deposits the produced COT').toBe(PLANNED);
    const rff = rffRequest(mw);
    expect(BigInt(rff.sources[0].value), 'RFF source == P').toBe(PLANNED);
    expect(BigInt(rff.destinations[0].value), 'RFF destination == P').toBe(PLANNED);
  });

  it('positive slippage · EXACT_IN · Nexus — re-derives the destination (gives MORE)', async () => {
    // minReceived floor is P, but A>P actually lands at the wrapper; the reclaim bridges A, and Nexus
    // re-derives the destination from the executed assets → the user is owed MORE on the destination.
    const { promise, middlewareClient: mw } = runExactIn({ provider: 'nexus', toTokenAddress: USDC_BASE, wrapperCot: SLIPPED_UP });
    await promise;

    expect(vaultApprovedCot(mw), 'bridge deposits the ACTUAL landed COT (A), not the floor P').toBe(SLIPPED_UP);
    const rff = rffRequest(mw);
    expect(BigInt(rff.sources[0].value), 'RFF source == A').toBe(SLIPPED_UP);
    expect(BigInt(rff.destinations[0].value), 'Nexus re-derives the destination from executed assets → A').toBe(SLIPPED_UP);
    expect(SLIPPED_UP, 'A > P → MORE on the destination').toBeGreaterThan(PLANNED);
  });

  it('positive slippage · EXACT_IN · Mayan — refresh keeps RFF value == effectiveAmountIn64 == A', async () => {
    // refreshMayanQuotesForExecution re-quotes the leg at the ACTUAL bridged A so the signed input
    // re-aligns. The submitRFF enforcement would throw "Mayan quote amount mismatch" otherwise (a4ba539).
    const { promise, middlewareClient: mw } = runExactIn({ provider: 'mayan', toTokenAddress: USDC_BASE, wrapperCot: SLIPPED_UP });
    await promise;

    const rff = rffRequest(mw);
    expect(BigInt(rff.sources[0].value), 'RFF source deposits A').toBe(SLIPPED_UP);
    const mayanQuotes =
      (mw.submitRFF.mock.calls[0]?.[0] as { mayanQuotes?: Array<{ effectiveAmountIn64: string }> })
        .mayanQuotes ?? [];
    expect(
      BigInt(mayanQuotes[0].effectiveAmountIn64),
      'refreshed effectiveAmountIn64 == A == value'
    ).toBe(SLIPPED_UP);
  });

  // ── requote lever: a failed source dispatch re-quotes; the pooled srcBuffer guards DOWNWARD drift ──

  it('requote DOWN within srcBuffer · EXACT_IN · Nexus — guard passes, swap completes', async () => {
    // dst swap present → srcBuffer is nonzero. The re-quote drops the QUOTE 0.05% (< the ~$1 buffer),
    // so the pooled guard (Σnew ≥ Σold − srcBuffer) passes and the swap completes.
    const drift = makeRequoteDrift({ chainId: ARB_CHAIN, sourceToken: SOURCE_DAI, factor: 0.9995 });
    const { promise, middlewareClient: mw } = runExactIn({ provider: 'nexus', toTokenAddress: WETH, wrapperCot: PLANNED, drift });
    await promise;

    expect(sourceSwapCount(mw), 'source swap retried once').toBe(2);
    expect(vaultApprovedCot(mw), 'completes; bridge deposits the produced COT').toBe(PLANNED);
  });

  it('requote DOWN within srcBuffer · EXACT_IN · Nexus — the re-dispatch carries the FRESH re-quote, not the stale prepared order', async () => {
    // Regression: on a failed source dispatch the leg re-quotes (output drifts 0.05% DOWN). The
    // RE-DISPATCHED swap must carry that fresh order — the echo stamps the quote's outputAmount into
    // the swap calldata, so a stale prepared-cache reuse shows the ORIGINAL output on attempt-1.
    const drift = makeRequoteDrift({ chainId: ARB_CHAIN, sourceToken: SOURCE_DAI, factor: 0.9995 });
    const { promise, middlewareClient: mw } = runExactIn({ provider: 'nexus', toTokenAddress: WETH, wrapperCot: PLANNED, drift });
    await promise;

    const swapBatches = sbcBatchesForChain(mw, ARB_CHAIN).filter((b) => b.some((c) => c.fn === 'swap'));
    expect(swapBatches, 'attempt-0 + re-dispatch').toHaveLength(2);
    const attempt0 = swapBatches[0].find((c) => c.fn === 'swap')!;
    const attempt1 = swapBatches[1].find((c) => c.fn === 'swap')!;

    const DRIFTED = (PLANNED * 9995n) / 10000n; // 0.05% DOWN
    expect(attempt0.args[3], 'attempt-0 = original quoted output').toBe(PLANNED);
    expect(attempt1.args[3], 're-dispatch carries the FRESH (drifted) output, not the stale one').toBe(DRIFTED);
  });

  it('requote DOWN beyond srcBuffer · EXACT_IN · Nexus — pooled guard aborts the swap', async () => {
    const drift = makeRequoteDrift({ chainId: ARB_CHAIN, sourceToken: SOURCE_DAI, factor: 0.95 }); // −5% ≫ $1 buffer
    const { promise } = runExactIn({ provider: 'nexus', toTokenAddress: WETH, wrapperCot: PLANNED, drift });
    await expect(promise, 'drop exceeds srcBuffer → EXTERNAL_RATES_DRIFT_EXCEEDED').rejects.toThrow(/srcBuffer/);
  });
});
