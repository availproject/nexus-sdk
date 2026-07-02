// TODO: rebaseline characterization snapshots after the smart-account-only refactor
//   (WalletPath = ephemeral | safe; no more SwapWalletMode / finalWalletPath /
//    bridgeFundingWalletPath / sourceRecipientWalletPath). describe() is .skip'd until
//   each scenario's expected execution paths, fee math, sendCalls counts, and
//   eoaToEphemeralTransfers are recomputed for the new model.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import {
  decodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  parseUnits,
  type Hex,
} from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { buildSwapPreflight } from '../../../src/swap/preflight';
import { prepareSwapExecution } from '../../../src/swap/prepare';
import { predictSafeAccountAddress } from '../../../src/swap/safe/predict';
import { buildSwapPreviewState, swap as flowSwap, type SwapPreviewState } from '../../../src/flows/swap';
import {
  getSwapBridgeDepositStep,
  getSwapBridgeFillStep,
  getSwapBridgeIntentSubmissionStep,
  getSwapDestinationSwapStep,
  getSwapSourceSwapStep,
} from '../../../src/swap/swap-steps-builder';
import { EADDRESS, SWEEPER_ADDRESS } from '../../../src/swap/constants';
import { SwapCache } from '../../../src/swap/wallet/cache';
import {
  SwapMode,
  type FlatBalance,
  type SwapIntent,
  type SwapParams,
  type WalletPath,
} from '../../../src/swap/types';
import type { MiddlewareClient } from '../../../src/transport';
import type { ChainListType, SwapEvent, TokenInfo } from '../../../src/domain';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  EPHEMERAL_EXECUTOR,
  OP_CHAIN,
  USDC_ARB,
  USDC_BASE,
  USDC_OP,
  WETH,
  makeSwapChainList,
} from '../../helpers/swap';
import { ERC20PermitABI } from '../../../src/abi/erc20';

const hoisted = vi.hoisted(() => {
  const readContract = vi.fn();
  const multicall = vi.fn();
  const getCode = vi.fn();
  const getTransactionCount = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const simulateContract = vi.fn();
  const watchContractEvent = vi.fn();

  const createPublicClient = vi.fn((options?: { chain?: unknown }) => ({
    chain: options?.chain,
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    simulateContract,
    watchContractEvent,
  }));

  const delegateGetChainId = vi.fn().mockResolvedValue(42161);
  const delegateSwitchChain = vi.fn().mockResolvedValue(undefined);
  const delegateAddChain = vi.fn().mockResolvedValue(undefined);
  const delegateWriteContract = vi.fn().mockResolvedValue(
    '0xeeee000000000000000000000000000000000001' as Hex
  );
  const delegateSignMessage = vi.fn().mockResolvedValue(
    '0x' + '11'.repeat(65)
  );

  const createWalletClient = vi.fn(() => ({
    getChainId: delegateGetChainId,
    switchChain: delegateSwitchChain,
    addChain: delegateAddChain,
    writeContract: delegateWriteContract,
    signMessage: delegateSignMessage,
  }));

  return {
    createPublicClient,
    createWalletClient,
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    simulateContract,
    watchContractEvent,
    delegateGetChainId,
    delegateSwitchChain,
    delegateAddChain,
    delegateWriteContract,
    delegateSignMessage,
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: hoisted.createPublicClient,
    createWalletClient: hoisted.createWalletClient,
    http: vi.fn().mockReturnValue({}),
    fallback: vi.fn().mockReturnValue({}),
  };
});

const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
// CREATE2 of the Safe-proxy with EPH as the sole 1-of-1 owner. Stable as long as EPH and
// Safe constants don't change. Cross-check by calling predictSafeAccountAddress(EPH) if
// either drifts.
const PREDICTED_SAFE_FOR_EPH = '0x2d7E4C3ef02B86D271624742C6e81636f4c9e663' as Hex;
const SOURCE_DAI = '0x0000000000000000000000000000000000000da1' as Hex;
const ARB_BEBOP_APPROVAL = '0x1111111111111111111111111111111111111111' as Hex;
const ARB_BEBOP_ROUTER = '0x1111111111111111111111111111111111112222' as Hex;
const OP_LIFI_APPROVAL = '0x2222222222222222222222222222222222221111' as Hex;
const OP_LIFI_ROUTER = '0x2222222222222222222222222222222222222222' as Hex;
const BASE_LIFI_APPROVAL = '0x3333333333333333333333333333333333331111' as Hex;
const BASE_LIFI_ROUTER = '0x3333333333333333333333333333333333332222' as Hex;
const BASE_BEBOP_APPROVAL = '0x3333333333333333333333333333333333333331' as Hex;
const BASE_BEBOP_ROUTER = '0x3333333333333333333333333333333333333332' as Hex;

const makeBridgeQuoteResponse = () => ({
  fulfillmentBps: 0,
  sources: [
    {
      chainId: ARB_CHAIN,
      tokenAddress: USDC_ARB,
      depositFeeUsd: '0',
      depositFeeToken: '0',
    },
    {
      chainId: OP_CHAIN,
      tokenAddress: USDC_OP,
      depositFeeUsd: '0',
      depositFeeToken: '0',
    },
    {
      chainId: BASE_CHAIN,
      tokenAddress: USDC_BASE,
      depositFeeUsd: '0',
      depositFeeToken: '0',
    },
  ],
  destination: {
    chainId: BASE_CHAIN,
    tokenAddress: USDC_BASE,
    fulfillmentFeeUsd: '0',
    fulfillmentFeeToken: '0',
  },
});

type ScenarioContext = {
  chainList: ChainListType;
  middlewareClient: MiddlewareClient & {
    getLiFiQuote: ReturnType<typeof vi.fn>;
    getBebopQuote: ReturnType<typeof vi.fn>;
    submitSBCs: ReturnType<typeof vi.fn>;
    submitRFF: ReturnType<typeof vi.fn>;
    getRFF: ReturnType<typeof vi.fn>;
    getRFFStatus: ReturnType<typeof vi.fn>;
    getSwapBalances: ReturnType<typeof vi.fn>;
    getOraclePrices: ReturnType<typeof vi.fn>;
  };
  eoaWallet: SwapParams['eoaWallet'] & {
    getCapabilities: ReturnType<typeof vi.fn>;
    sendCalls: ReturnType<typeof vi.fn>;
    waitForCallsStatus: ReturnType<typeof vi.fn>;
    writeContract: ReturnType<typeof vi.fn>;
  };
  ephemeralWallet: PrivateKeyAccount;
  params: SwapParams;
  input: {
    mode: SwapMode.EXACT_OUT;
    data: {
      sources: Array<{ chainId: number; tokenAddress: Hex }>;
      toChainId: number;
      toTokenAddress: Hex;
      toAmountRaw: bigint;
      toNativeAmountRaw?: bigint;
    };
  };
  emittedEvents: SwapEvent[];
  capturedIntent: { current: SwapIntent | null };
};

type HarnessResult = ScenarioContext & {
  preflight: Awaited<ReturnType<typeof buildSwapPreflight>>;
  previewState: SwapPreviewState;
  preparedExecution: Awaited<ReturnType<typeof prepareSwapExecution>>;
  swapResult: Awaited<ReturnType<typeof flowSwap>>;
  submitSbcChainIds: number[];
};

const runSwap = (input: Parameters<typeof flowSwap>[0], params: SwapParams) =>
  flowSwap(
    input,
    {
      chainList: params.chainList,
      middlewareClient: params.middlewareClient,
      intentExplorerUrl: params.intentExplorerUrl,
      evm: {
        walletClient: params.eoaWallet,
        address: params.eoaAddress,
      },
      swap: {
        ephemeralWallet: params.ephemeralWallet,
        cotCurrencyId: params.cotCurrencyId,
      },
    },
    {
      onIntent: params.onIntent,
      onEvent: params.emit,
      preloadedBalances: params.preloadedBalances,
      slippageTolerance: params.slippage,
    }
  );

type ExactOutScenario = {
  name: string;
  destinationHas7702: boolean;
  balances?: FlatBalance[];
  sources?: Array<{ chainId: number; tokenAddress: Hex }>;
  destinationTokenAddress: Hex;
  destinationAmountRaw: bigint;
  toNativeAmountRaw: bigint;
  expected: {
    sourceSwapChainIds: number[];
    sourceSwapAggregators: Array<{ chainId: number; aggregator: 'BebopAggregator' | 'LiFiAggregator' }>;
    directCotChains: number[];
    sourceExecutionPaths: Array<[number, WalletPath]>;
    hasBridge: boolean;
    expectsDestinationSwap: boolean;
    expectedDestinationAggregator: 'BebopAggregator' | null;
    expectedSendCallsCount: number;
    expectedWriteContractCount: number;
    expectedEoaRouters: Hex[];
    expectedSubmitSbcChainIds: number[];
    expectedBridgeRecipient: Hex | null;
    expectsNativeSweep: boolean;
    sourceQuoteExpectations: Array<{
      chainId: number;
      executor: Hex;
      recipient: Hex;
    }>;
    destinationQuoteExpectation?: {
      executor: Hex;
      recipient: Hex;
    };
    eoaToEphemeralTransfers: Array<{
      reason: 'source' | 'bridge' | 'destination';
      chainId: number;
      tokenAddress: Hex;
    }>;
    bridgeAssetOwnership: Array<{
      chainId: number;
      hasEoaBalance: boolean;
      hasEphemeralBalance: boolean;
    }>;
  };
};

const SCENARIOS: ExactOutScenario[] = [
  {
    name: 'COT destination without gas on 7702 chain',
    destinationHas7702: true,
    destinationTokenAddress: USDC_BASE,
    destinationAmountRaw: parseUnits('1600', 6),
    toNativeAmountRaw: 0n,
    expected: {
      sourceSwapChainIds: [ARB_CHAIN, OP_CHAIN],
      sourceSwapAggregators: [
        { chainId: ARB_CHAIN, aggregator: 'BebopAggregator' },
        { chainId: OP_CHAIN, aggregator: 'LiFiAggregator' },
      ],
      directCotChains: [],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: false,
      expectedDestinationAggregator: null,
      expectedSendCallsCount: 1,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [ARB_BEBOP_ROUTER],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN],
      expectedBridgeRecipient: EOA,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [
        { chainId: ARB_CHAIN, executor: EPH, recipient: EPH },
        { chainId: OP_CHAIN, executor: EPH, recipient: EPH },
      ],
      eoaToEphemeralTransfers: [
        { reason: 'source', chainId: OP_CHAIN, tokenAddress: SOURCE_DAI },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
        { chainId: OP_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
      ],
    },
  },
  {
    name: 'COT destination with gas on 7702 chain',
    destinationHas7702: true,
    destinationTokenAddress: USDC_BASE,
    destinationAmountRaw: parseUnits('1600', 6),
    toNativeAmountRaw: parseUnits('0.01', 18),
    expected: {
      sourceSwapChainIds: [ARB_CHAIN, OP_CHAIN],
      sourceSwapAggregators: [
        { chainId: ARB_CHAIN, aggregator: 'BebopAggregator' },
        { chainId: OP_CHAIN, aggregator: 'LiFiAggregator' },
      ],
      directCotChains: [],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: false,
      expectedDestinationAggregator: null,
      expectedSendCallsCount: 1,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [ARB_BEBOP_ROUTER],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN],
      expectedBridgeRecipient: EOA,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [
        { chainId: ARB_CHAIN, executor: EPH, recipient: EPH },
        { chainId: OP_CHAIN, executor: EPH, recipient: EPH },
      ],
      eoaToEphemeralTransfers: [
        { reason: 'source', chainId: OP_CHAIN, tokenAddress: SOURCE_DAI },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
        { chainId: OP_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
      ],
    },
  },
  {
    name: 'non-COT destination with gas on 7702 chain',
    destinationHas7702: true,
    destinationTokenAddress: WETH,
    destinationAmountRaw: parseUnits('1', 18),
    toNativeAmountRaw: parseUnits('0.01', 18),
    expected: {
      sourceSwapChainIds: [ARB_CHAIN, OP_CHAIN],
      sourceSwapAggregators: [
        { chainId: ARB_CHAIN, aggregator: 'BebopAggregator' },
        { chainId: OP_CHAIN, aggregator: 'LiFiAggregator' },
      ],
      directCotChains: [],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: true,
      expectedDestinationAggregator: 'BebopAggregator',
      expectedSendCallsCount: 1,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [ARB_BEBOP_ROUTER],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN, BASE_CHAIN],
      expectedBridgeRecipient: EPH,
      expectsNativeSweep: true,
      sourceQuoteExpectations: [
        { chainId: ARB_CHAIN, executor: EPH, recipient: EPH },
        { chainId: OP_CHAIN, executor: EPH, recipient: EPH },
      ],
      destinationQuoteExpectation: { executor: EPH, recipient: EOA },
      eoaToEphemeralTransfers: [
        { reason: 'source', chainId: OP_CHAIN, tokenAddress: SOURCE_DAI },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
        { chainId: OP_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
      ],
    },
  },
  {
    // Non-7702 destination + needs token swap → finalWalletPath='safe'. Bridge fills to the
    // predicted Safe address; Safe.execTransaction runs the dst aggregator swap and delivers
    // output to the EOA. The user signs zero destination-side EOA transactions (was 1 before
    // the Safe-destination fix).
    name: 'non-COT destination with gas on non-7702 chain',
    destinationHas7702: false,
    destinationTokenAddress: WETH,
    destinationAmountRaw: parseUnits('1', 18),
    toNativeAmountRaw: parseUnits('0.01', 18),
    expected: {
      sourceSwapChainIds: [ARB_CHAIN, OP_CHAIN],
      sourceSwapAggregators: [
        { chainId: ARB_CHAIN, aggregator: 'BebopAggregator' },
        { chainId: OP_CHAIN, aggregator: 'LiFiAggregator' },
      ],
      directCotChains: [],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: true,
      expectedDestinationAggregator: 'BebopAggregator',
      expectedSendCallsCount: 1,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [ARB_BEBOP_ROUTER],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN],
      expectedBridgeRecipient: PREDICTED_SAFE_FOR_EPH,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [
        { chainId: ARB_CHAIN, executor: EPH, recipient: EPH },
        { chainId: OP_CHAIN, executor: EPH, recipient: EPH },
      ],
      destinationQuoteExpectation: { executor: PREDICTED_SAFE_FOR_EPH, recipient: EOA },
      eoaToEphemeralTransfers: [
        { reason: 'source', chainId: OP_CHAIN, tokenAddress: SOURCE_DAI },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
        { chainId: OP_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
      ],
    },
  },
  {
    name: 'mixed swapped source and direct COT bridge with COT destination',
    destinationHas7702: true,
    balances: [
      {
        amount: '1200',
        chainID: ARB_CHAIN,
        decimals: 18,
        symbol: 'DAI',
        tokenAddress: SOURCE_DAI,
        value: 1200,
        name: 'DAI',
        logo: '',
      },
      {
        amount: '700',
        chainID: OP_CHAIN,
        decimals: 6,
        symbol: 'USDC',
        tokenAddress: USDC_OP,
        value: 700,
        name: 'USDC',
        logo: '',
      },
    ],
    sources: [
      { chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI },
      { chainId: OP_CHAIN, tokenAddress: USDC_OP },
    ],
    destinationTokenAddress: USDC_BASE,
    destinationAmountRaw: parseUnits('1600', 6),
    toNativeAmountRaw: 0n,
    expected: {
      sourceSwapChainIds: [ARB_CHAIN],
      sourceSwapAggregators: [{ chainId: ARB_CHAIN, aggregator: 'BebopAggregator' }],
      directCotChains: [OP_CHAIN],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: false,
      expectedDestinationAggregator: null,
      expectedSendCallsCount: 1,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [ARB_BEBOP_ROUTER],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN],
      expectedBridgeRecipient: EOA,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [{ chainId: ARB_CHAIN, executor: EPH, recipient: EPH }],
      eoaToEphemeralTransfers: [
        { reason: 'bridge', chainId: OP_CHAIN, tokenAddress: USDC_OP },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
        { chainId: OP_CHAIN, hasEoaBalance: true, hasEphemeralBalance: false },
      ],
    },
  },
  {
    name: 'same-chain direct COT exact-out does destination handoff without bridge',
    destinationHas7702: true,
    balances: [
      {
        amount: '1700',
        chainID: BASE_CHAIN,
        decimals: 6,
        symbol: 'USDC',
        tokenAddress: USDC_BASE,
        value: 1700,
        name: 'USDC',
        logo: '',
      },
    ],
    sources: [{ chainId: BASE_CHAIN, tokenAddress: USDC_BASE }],
    destinationTokenAddress: WETH,
    destinationAmountRaw: parseUnits('1', 18),
    toNativeAmountRaw: 0n,
    expected: {
      sourceSwapChainIds: [],
      sourceSwapAggregators: [],
      directCotChains: [BASE_CHAIN],
      sourceExecutionPaths: [[BASE_CHAIN, 'ephemeral']],
      hasBridge: false,
      expectsDestinationSwap: true,
      expectedDestinationAggregator: 'BebopAggregator',
      expectedSendCallsCount: 0,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [],
      expectedSubmitSbcChainIds: [BASE_CHAIN],
      expectedBridgeRecipient: null,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [],
      destinationQuoteExpectation: { executor: EPH, recipient: EOA },
      eoaToEphemeralTransfers: [
        { reason: 'destination', chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
      ],
      bridgeAssetOwnership: [],
    },
  },
  {
    name: 'destination local COT plus bridged swap source on 7702 destination',
    destinationHas7702: true,
    balances: [
      {
        amount: '1200',
        chainID: ARB_CHAIN,
        decimals: 18,
        symbol: 'DAI',
        tokenAddress: SOURCE_DAI,
        value: 1200,
        name: 'DAI',
        logo: '',
      },
      {
        amount: '700',
        chainID: BASE_CHAIN,
        decimals: 6,
        symbol: 'USDC',
        tokenAddress: USDC_BASE,
        value: 700,
        name: 'USDC',
        logo: '',
      },
    ],
    sources: [
      { chainId: ARB_CHAIN, tokenAddress: SOURCE_DAI },
      { chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
    ],
    destinationTokenAddress: WETH,
    destinationAmountRaw: parseUnits('1', 18),
    toNativeAmountRaw: 0n,
    expected: {
      sourceSwapChainIds: [ARB_CHAIN],
      sourceSwapAggregators: [{ chainId: ARB_CHAIN, aggregator: 'BebopAggregator' }],
      directCotChains: [BASE_CHAIN],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [BASE_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: true,
      expectedDestinationAggregator: 'BebopAggregator',
      expectedSendCallsCount: 1,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [ARB_BEBOP_ROUTER],
      expectedSubmitSbcChainIds: [ARB_CHAIN, BASE_CHAIN],
      expectedBridgeRecipient: EPH,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [{ chainId: ARB_CHAIN, executor: EPH, recipient: EPH }],
      destinationQuoteExpectation: { executor: EPH, recipient: EOA },
      eoaToEphemeralTransfers: [
        { reason: 'destination', chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
      ],
      bridgeAssetOwnership: [{ chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true }],
    },
  },
  {
    // Smart-account-only refactor removed the `swapWalletMode='eoa'` opt-in — every source
    // now executes through a wrapper. This scenario stays in the suite to ensure the legacy
    // EOA-direct surface is gone (bridge assets carry `ephemeralBalance`, not `eoaBalance`).
    name: 'eoa-only keeps all swaps and bridge custody on eoa',
    destinationHas7702: true,
    destinationTokenAddress: WETH,
    destinationAmountRaw: parseUnits('1', 18),
    toNativeAmountRaw: 0n,
    expected: {
      sourceSwapChainIds: [ARB_CHAIN, OP_CHAIN],
      sourceSwapAggregators: [
        { chainId: ARB_CHAIN, aggregator: 'BebopAggregator' },
        { chainId: OP_CHAIN, aggregator: 'LiFiAggregator' },
      ],
      directCotChains: [],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: true,
      expectedDestinationAggregator: 'BebopAggregator',
      expectedSendCallsCount: 0,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN, BASE_CHAIN],
      expectedBridgeRecipient: EPH,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [
        { chainId: ARB_CHAIN, executor: EPH, recipient: EPH },
        { chainId: OP_CHAIN, executor: EPH, recipient: EPH },
      ],
      destinationQuoteExpectation: { executor: EPH, recipient: EOA },
      eoaToEphemeralTransfers: [
        { reason: 'source', chainId: OP_CHAIN, tokenAddress: SOURCE_DAI },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
        { chainId: OP_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
      ],
    },
  },
  {
    // Same shape as above but on a non-7702 destination, so the dst wrapper is the per-EOA
    // Safe. Bridge recipient is the predicted Safe address.
    name: 'eoa-only with gas on non-7702 destination keeps bridge and destination on eoa',
    destinationHas7702: false,
    destinationTokenAddress: WETH,
    destinationAmountRaw: parseUnits('1', 18),
    toNativeAmountRaw: parseUnits('0.01', 18),
    expected: {
      sourceSwapChainIds: [ARB_CHAIN, OP_CHAIN],
      sourceSwapAggregators: [
        { chainId: ARB_CHAIN, aggregator: 'BebopAggregator' },
        { chainId: OP_CHAIN, aggregator: 'LiFiAggregator' },
      ],
      directCotChains: [],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: true,
      expectedDestinationAggregator: 'BebopAggregator',
      expectedSendCallsCount: 0,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN],
      expectedBridgeRecipient: PREDICTED_SAFE_FOR_EPH,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [
        { chainId: ARB_CHAIN, executor: EPH, recipient: EPH },
        { chainId: OP_CHAIN, executor: EPH, recipient: EPH },
      ],
      destinationQuoteExpectation: { executor: PREDICTED_SAFE_FOR_EPH, recipient: EOA },
      eoaToEphemeralTransfers: [
        { reason: 'source', chainId: OP_CHAIN, tokenAddress: SOURCE_DAI },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
        { chainId: OP_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
      ],
    },
  },
  {
    name: 'multiple direct COT chains bridge without source swaps',
    destinationHas7702: true,
    balances: [
      {
        amount: '900',
        chainID: ARB_CHAIN,
        decimals: 6,
        symbol: 'USDC',
        tokenAddress: USDC_ARB,
        value: 900,
        name: 'USDC',
        logo: '',
      },
      {
        amount: '900',
        chainID: OP_CHAIN,
        decimals: 6,
        symbol: 'USDC',
        tokenAddress: USDC_OP,
        value: 900,
        name: 'USDC',
        logo: '',
      },
    ],
    sources: [
      { chainId: ARB_CHAIN, tokenAddress: USDC_ARB },
      { chainId: OP_CHAIN, tokenAddress: USDC_OP },
    ],
    destinationTokenAddress: USDC_BASE,
    destinationAmountRaw: parseUnits('1600', 6),
    toNativeAmountRaw: 0n,
    expected: {
      sourceSwapChainIds: [],
      sourceSwapAggregators: [],
      directCotChains: [ARB_CHAIN, OP_CHAIN],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: false,
      expectedDestinationAggregator: null,
      expectedSendCallsCount: 0,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN],
      expectedBridgeRecipient: EOA,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [],
      eoaToEphemeralTransfers: [
        { reason: 'bridge', chainId: ARB_CHAIN, tokenAddress: USDC_ARB },
        { reason: 'bridge', chainId: OP_CHAIN, tokenAddress: USDC_OP },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: true, hasEphemeralBalance: false },
        { chainId: OP_CHAIN, hasEoaBalance: true, hasEphemeralBalance: false },
      ],
    },
  },
  {
    name: 'ephemeral-preferred uses ephemeral execution end-to-end where supported',
    destinationHas7702: true,
    destinationTokenAddress: WETH,
    destinationAmountRaw: parseUnits('1', 18),
    toNativeAmountRaw: 0n,
    expected: {
      sourceSwapChainIds: [ARB_CHAIN, OP_CHAIN],
      sourceSwapAggregators: [
        { chainId: ARB_CHAIN, aggregator: 'BebopAggregator' },
        { chainId: OP_CHAIN, aggregator: 'LiFiAggregator' },
      ],
      directCotChains: [],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectsDestinationSwap: true,
      expectedDestinationAggregator: 'BebopAggregator',
      expectedSendCallsCount: 0,
      expectedWriteContractCount: 0,
      expectedEoaRouters: [],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN, BASE_CHAIN],
      expectedBridgeRecipient: EPH,
      expectsNativeSweep: false,
      sourceQuoteExpectations: [
        { chainId: ARB_CHAIN, executor: EPH, recipient: EPH },
        { chainId: OP_CHAIN, executor: EPH, recipient: EPH },
      ],
      destinationQuoteExpectation: { executor: EPH, recipient: EOA },
      eoaToEphemeralTransfers: [
        // ARB source swaps via Bebop, whose quote carries the checksummed token address
        // (matches ca-common); OP swaps via LiFi, which still returns the lowercase form.
        { reason: 'source', chainId: ARB_CHAIN, tokenAddress: getAddress(SOURCE_DAI) },
        { reason: 'source', chainId: OP_CHAIN, tokenAddress: SOURCE_DAI },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
        { chainId: OP_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
      ],
    },
  },
];

const toBytes32Address = (address: Hex) =>
  (`0x${address.slice(2).toLowerCase().padStart(64, '0')}`) as Hex;

const flattenEoaCalls = (wallet: ScenarioContext['eoaWallet']) =>
  wallet.sendCalls.mock.calls.flatMap(([call]) => call.calls as Array<{ to: Hex; data: Hex; value: bigint }>);

const expectStatusSequence = (events: SwapEvent[]) => {
  const statuses = events
    .filter((event): event is Extract<SwapEvent, { type: 'status' }> => event.type === 'status')
    .map((event) => event.status);
  const expected = [
    'route_building',
    'route_ready',
    'awaiting_approval',
    'approved',
    'executing',
    'completed',
  ] as const;

  let cursor = -1;
  for (const status of expected) {
    cursor = statuses.indexOf(status, cursor + 1);
    expect(cursor).toBeGreaterThan(-1);
  }
  expect(statuses.at(-1)).toBe('completed');
};

const DAI_PERMIT_ABI = [
  {
    type: 'function',
    name: 'permit',
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
    stateMutability: 'nonpayable',
  },
] as const;

const decodeTokenFunctionName = (data: Hex): string => {
  for (const abi of [erc20Abi, ERC20PermitABI, DAI_PERMIT_ABI] as const) {
    try {
      return decodeFunctionData({ abi, data }).functionName;
    } catch {
      continue;
    }
  }
  return 'unknown';
};

const getDefaultBalances = (): FlatBalance[] => [
  {
    amount: '1200',
    chainID: ARB_CHAIN,
    decimals: 18,
    symbol: 'DAI',
    tokenAddress: SOURCE_DAI,
    value: 1200,
    name: 'DAI',
    logo: '',
  },
  {
    amount: '1200',
    chainID: OP_CHAIN,
    decimals: 18,
    symbol: 'DAI',
    tokenAddress: SOURCE_DAI,
    value: 1080,
    name: 'DAI',
    logo: '',
  },
];

const makeChainList = (destinationHas7702: boolean): ChainListType => {
  const chainList = makeSwapChainList();
  const originalGetChainByID = chainList.getChainByID;
  const originalGetTokenByAddress = chainList.getTokenByAddress;
  chainList.getVaultContractAddress = vi.fn().mockImplementation((chainId: number) => {
    if (chainId === ARB_CHAIN) return '0x4444444444444444444444444444444444444441';
    if (chainId === OP_CHAIN) return '0x4444444444444444444444444444444444444442';
    if (chainId === BASE_CHAIN) return '0x4444444444444444444444444444444444444443';
    return '0x4444444444444444444444444444444444444444';
  });
  chainList.getChainByID = vi.fn().mockImplementation((chainId: number) => {
    const chain = originalGetChainByID(chainId);
    if (chainId === ARB_CHAIN) {
      return {
        ...chain,
        name: 'Arbitrum',
        blockExplorers: { default: { name: 'Arbiscan', url: 'https://arbiscan.io' } },
        custom: { ...chain.custom, icon: 'https://arb.example/icon.png' },
      };
    }
    if (chainId === OP_CHAIN) {
      return {
        ...chain,
        name: 'Optimism',
        blockExplorers: { default: { name: 'Optimistic Etherscan', url: 'https://optimistic.etherscan.io' } },
        custom: { ...chain.custom, icon: 'https://op.example/icon.png' },
      };
    }
    if (chainId === BASE_CHAIN) {
      return {
        ...chain,
        name: 'Base',
        supports7702: destinationHas7702,
        blockExplorers: { default: { name: 'Basescan', url: 'https://basescan.org' } },
        custom: { ...chain.custom, icon: 'https://base.example/icon.png' },
      };
    }
    return chain;
  });
  chainList.getNativeToken = vi.fn().mockImplementation((chainId: number) => {
    const chain = chainList.getChainByID(chainId);
    return {
      contractAddress: '0x0000000000000000000000000000000000000000' as Hex,
      decimals: chain.nativeCurrency.decimals,
      logo: chain.nativeCurrency.logo,
      name: chain.nativeCurrency.name,
      symbol: chain.nativeCurrency.symbol,
    };
  });
  chainList.getTokenByAddress = vi.fn().mockImplementation((chainId: number, tokenAddress: Hex) => {
    if (tokenAddress.toLowerCase() === SOURCE_DAI.toLowerCase()) {
      return {
        contractAddress: SOURCE_DAI,
        decimals: 18,
        logo: '',
        name: 'Dai Stablecoin',
        symbol: 'DAI',
        permitVariant: 2,
        permitVersion: 1,
      };
    }
    return originalGetTokenByAddress(chainId, tokenAddress);
  });
  return chainList;
};

const tokenInfoByAddress = (tokenAddress: Hex): Pick<TokenInfo, 'symbol' | 'decimals'> => {
  const normalized = tokenAddress.toLowerCase();
  if (normalized === SOURCE_DAI.toLowerCase()) return { symbol: 'DAI', decimals: 18 };
  if (normalized === EADDRESS.toLowerCase()) return { symbol: 'ETH', decimals: 18 };
  if (normalized === USDC_ARB.toLowerCase()) return { symbol: 'USDC', decimals: 6 };
  if (normalized === USDC_OP.toLowerCase()) return { symbol: 'USDC', decimals: 6 };
  if (normalized === USDC_BASE.toLowerCase()) return { symbol: 'USDC', decimals: 6 };
  if (normalized === WETH.toLowerCase()) return { symbol: 'WETH', decimals: 18 };
  throw new Error(`Unknown token ${tokenAddress}`);
};

const RATE_BY_AGGREGATOR: Record<string, Record<string, Decimal>> = {
  lifi: {
    [`${BASE_CHAIN}:${EADDRESS.toLowerCase()}:${USDC_BASE.toLowerCase()}`]: new Decimal('3000'),
    [`${BASE_CHAIN}:${USDC_BASE.toLowerCase()}:${EADDRESS.toLowerCase()}`]: new Decimal('0.000333333333333333'),
    [`${BASE_CHAIN}:${WETH.toLowerCase()}:${USDC_BASE.toLowerCase()}`]: new Decimal('1500'),
    [`${BASE_CHAIN}:${USDC_BASE.toLowerCase()}:${WETH.toLowerCase()}`]: new Decimal('0.000666666666666666'),
    [`${ARB_CHAIN}:${USDC_ARB.toLowerCase()}:${EADDRESS.toLowerCase()}`]: new Decimal('0.000333333333333333'),
    [`${ARB_CHAIN}:${SOURCE_DAI.toLowerCase()}:${USDC_ARB.toLowerCase()}`]: new Decimal('0.72'),
    [`${OP_CHAIN}:${SOURCE_DAI.toLowerCase()}:${USDC_OP.toLowerCase()}`]: new Decimal('0.95'),
  },
  bebop: {
    [`${BASE_CHAIN}:${EADDRESS.toLowerCase()}:${USDC_BASE.toLowerCase()}`]: new Decimal('2900'),
    [`${BASE_CHAIN}:${USDC_BASE.toLowerCase()}:${EADDRESS.toLowerCase()}`]: new Decimal('0.000344827586206896'),
    [`${BASE_CHAIN}:${WETH.toLowerCase()}:${USDC_BASE.toLowerCase()}`]: new Decimal('1450'),
    [`${BASE_CHAIN}:${USDC_BASE.toLowerCase()}:${WETH.toLowerCase()}`]: new Decimal('0.000689655172413793'),
    [`${ARB_CHAIN}:${USDC_ARB.toLowerCase()}:${EADDRESS.toLowerCase()}`]: new Decimal('0.000344827586206896'),
    [`${ARB_CHAIN}:${SOURCE_DAI.toLowerCase()}:${USDC_ARB.toLowerCase()}`]: new Decimal('0.8'),
    [`${OP_CHAIN}:${SOURCE_DAI.toLowerCase()}:${USDC_OP.toLowerCase()}`]: new Decimal('0.85'),
  },
};

const rateKey = (chainId: number, inputToken: Hex, outputToken: Hex) =>
  `${chainId}:${inputToken.toLowerCase()}:${outputToken.toLowerCase()}`;

const getRate = (
  aggregator: 'lifi' | 'bebop',
  chainId: number,
  inputToken: Hex,
  outputToken: Hex
) => {
  const rate = RATE_BY_AGGREGATOR[aggregator][rateKey(chainId, inputToken, outputToken)];
  if (!rate) {
    throw new Error(
      `Missing ${aggregator} rate for ${chainId}:${inputToken}:${outputToken}`
    );
  }
  return rate;
};

const toRawAmount = (amount: Decimal, decimals: number) => parseUnits(amount.toFixed(decimals), decimals);

const fromRawAmount = (amountRaw: bigint, decimals: number) => new Decimal(formatUnits(amountRaw, decimals));

const makeLiFiResponse = (params: Record<string, string>, exactOut = false) => {
  const chainId = Number(params.fromChain);
  const inputToken = params.fromToken as Hex;
  const outputToken = params.toToken as Hex;
  const inputMeta = tokenInfoByAddress(inputToken);
  const outputMeta = tokenInfoByAddress(outputToken);
  const rate = getRate('lifi', chainId, inputToken, outputToken);

  const outputAmountHuman = exactOut
    ? fromRawAmount(BigInt(params.toAmount), outputMeta.decimals)
    : fromRawAmount(BigInt(params.fromAmount), inputMeta.decimals).mul(rate);
  const inputAmountHuman = exactOut
    ? outputAmountHuman.div(rate)
    : fromRawAmount(BigInt(params.fromAmount), inputMeta.decimals);

  const inputAmountRaw = toRawAmount(inputAmountHuman, inputMeta.decimals);
  const outputAmountRaw = toRawAmount(outputAmountHuman, outputMeta.decimals);
  const approvalAddress =
    chainId === BASE_CHAIN ? BASE_LIFI_APPROVAL : OP_LIFI_APPROVAL;
  const router = chainId === BASE_CHAIN ? BASE_LIFI_ROUTER : OP_LIFI_ROUTER;

  return {
    estimate: {
      fromAmount: inputAmountRaw.toString(),
      fromAmountUSD: inputAmountHuman.toFixed(2),
      toAmount: outputAmountRaw.toString(),
      toAmountMin: outputAmountRaw.toString(),
      toAmountUSD: outputAmountHuman.toFixed(2),
      approvalAddress,
      feeCosts: [],
      gasCosts: [],
    },
    action: {
      fromToken: {
        address: inputToken,
        symbol: inputMeta.symbol,
        decimals: inputMeta.decimals,
        priceUSD: '1',
      },
      toToken: {
        address: outputToken,
        symbol: outputMeta.symbol,
        decimals: outputMeta.decimals,
        priceUSD: '1',
      },
    },
    transactionRequest: {
      to: router,
      data: '0xabcdef',
      value: '0x0',
    },
  };
};

const makeBebopResponse = (params: Record<string, string>) => {
  const CHAIN_ID_BY_NAME: Record<string, number> = {
    arbitrum: ARB_CHAIN,
    optimism: OP_CHAIN,
    base: BASE_CHAIN,
  };
  const chainId = CHAIN_ID_BY_NAME[params.chain];
  const inputToken = params.sell_tokens as Hex;
  const outputToken = params.buy_tokens as Hex;
  const inputMeta = tokenInfoByAddress(inputToken);
  const outputMeta = tokenInfoByAddress(outputToken);
  const rate = getRate('bebop', chainId, inputToken, outputToken);
  const isExactOut = params.buy_amounts !== undefined;

  const outputAmountHuman = isExactOut
    ? fromRawAmount(BigInt(params.buy_amounts), outputMeta.decimals)
    : fromRawAmount(BigInt(params.sell_amounts), inputMeta.decimals).mul(rate);
  const inputAmountHuman = isExactOut
    ? outputAmountHuman.div(rate)
    : fromRawAmount(BigInt(params.sell_amounts), inputMeta.decimals);

  const inputAmountRaw = toRawAmount(inputAmountHuman, inputMeta.decimals);
  const outputAmountRaw = toRawAmount(outputAmountHuman, outputMeta.decimals);
  const approvalAddress = chainId === ARB_CHAIN ? ARB_BEBOP_APPROVAL : BASE_BEBOP_APPROVAL;
  const router = chainId === ARB_CHAIN ? ARB_BEBOP_ROUTER : BASE_BEBOP_ROUTER;

  return {
    routes: [
      {
        quote: {
          buyTokens: {
            [outputToken]: {
              minimumAmount: outputAmountRaw.toString(),
              priceUsd: outputMeta.symbol === 'USDC' ? 1 : 1500,
              symbol: outputMeta.symbol,
              decimals: outputMeta.decimals,
            },
          },
          sellTokens: {
            [inputToken]: {
              amount: inputAmountRaw.toString(),
              priceUsd: inputMeta.symbol === 'USDC' ? 1 : 1500,
              symbol: inputMeta.symbol,
              decimals: inputMeta.decimals,
            },
          },
          approvalTarget: approvalAddress,
          tx: {
            to: router,
            data: '0xfedcba',
            value: '0x0',
          },
          expiry: Math.floor(Date.now() / 1000) + 60,
        },
      },
    ],
  };
};

const extractSbcChainIds = (call: unknown): number[] =>
  (call as Array<{ chainId: number }>).map((tx) => tx.chainId);

const SWEEPER_ABI = [
  {
    type: 'function',
    name: 'sweepERC20',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'sweepERC7914',
    inputs: [{ name: 'receiver', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const getSubmittedSbcCallsForChain = (
  middlewareClient: ScenarioContext['middlewareClient'],
  chainId: number
) =>
  middlewareClient.submitSBCs.mock.calls
    .flatMap(([txs]) => txs as Array<{ chainId: number; calls: Array<{ to: Hex; data: Hex }> }>)
    .filter((tx) => tx.chainId === chainId)
    .flatMap((tx) =>
      tx.calls.map((call) => ({
        to: call.to,
        data: call.data,
      }))
    );

const getBebopCallsForChain = (
  middlewareClient: ScenarioContext['middlewareClient'],
  chainId: number
) => {
  const chainNameById: Record<number, string> = {
    [ARB_CHAIN]: 'arbitrum',
    [OP_CHAIN]: 'optimism',
    [BASE_CHAIN]: 'base',
  };
  return middlewareClient.getBebopQuote.mock.calls
    .map(([params]) => params as Record<string, string>)
    .filter((params) => params.chain === chainNameById[chainId]);
};

const getLiFiCallsForChain = (
  middlewareClient: ScenarioContext['middlewareClient'],
  chainId: number
) =>
  middlewareClient.getLiFiQuote.mock.calls
    .map(([params, exactOut]) => [params as Record<string, string>, exactOut] as const)
    .filter(([params]) => Number(params.fromChain) === chainId && Number(params.toChain) === chainId);

const makeScenario = (scenario: ExactOutScenario): ScenarioContext => {
  const chainList = makeChainList(scenario.destinationHas7702);
  const emittedEvents: SwapEvent[] = [];
  const capturedIntent = { current: null as SwapIntent | null };
  let currentEoaChainId = ARB_CHAIN;

  const middlewareClient = {
    getSwapBalances: vi.fn().mockResolvedValue(scenario.balances ?? getDefaultBalances()),
    getOraclePrices: vi.fn().mockResolvedValue([
      {
        universe: 'EVM' as const,
        chainId: BASE_CHAIN,
        tokenAddress: '0x0000000000000000000000000000000000000000' as Hex,
        tokenSymbol: 'ETH',
        tokenDecimals: 18,
        priceUsd: new Decimal(3000),
        timestamp: 1,
      },
      {
        universe: 'EVM' as const,
        chainId: BASE_CHAIN,
        tokenAddress: USDC_BASE,
        tokenSymbol: 'USDC',
        tokenDecimals: 6,
        priceUsd: new Decimal(1),
        timestamp: 1,
      },
    ]),
    getLiFiQuote: vi.fn().mockImplementation(async (params: Record<string, string>, exactOut?: boolean) =>
      makeLiFiResponse(params, Boolean(exactOut))
    ),
    getBebopQuote: vi.fn().mockImplementation(async (params: Record<string, string>) =>
      makeBebopResponse(params)
    ),
    getQuote: vi.fn().mockResolvedValue(makeBridgeQuoteResponse()),
    getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'nexus' }),
    getMayanQuotes: vi.fn(),
    submitSBCs: vi.fn().mockImplementation(async (txs: Array<{ chainId: number; address: Hex }>) =>
      txs.map((tx, index) => ({
        chainId: tx.chainId,
        address: tx.address,
        errored: false as const,
        txHash: (`0x${(index + 1).toString(16).padStart(64, '0')}`) as Hex,
      }))
    ),
    submitRFF: vi.fn().mockResolvedValue({
      request_hash: '0x9999999999999999999999999999999999999999999999999999999999999999' as Hex,
    }),
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
      request_hash:
        '0x9999999999999999999999999999999999999999999999999999999999999999' as Hex,
      status: 'fulfilled',
      solver: null,
    }),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'fulfilled' }),
    // Non-7702 Safe support: source-swap/bridge-deposit/destination-swap on non-Pectra chains
    // dispatch via Safe.execTransaction instead of Calibur SBC. The scenario only exercises
    // these when destinationHas7702=false (Safe wraps the dst swap) or a source uses 'safe'.
    ensureSafeAccount: vi.fn().mockResolvedValue({
      chainId: BASE_CHAIN,
      owner: EPH,
      address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
      factoryAddress: '0x0000000000000000000000000000000000000000' as Hex,
      exists: true,
    }),
    createSafeExecuteTx: vi.fn().mockResolvedValue({
      txHash: '0xsafedst000000000000000000000000000000000000000000000000000000aaaa' as Hex,
    }),
    getSafeAccountAddress: vi.fn().mockResolvedValue({
      address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
    }),
    configureTiming: vi.fn(),
    destroy: vi.fn(),
  } as unknown as ScenarioContext['middlewareClient'];

  const eoaWallet = {
    getCapabilities: vi.fn().mockResolvedValue({
      42161: { atomic: { status: 'supported' } },
      10: { atomic: { status: 'unsupported' } },
      8453: { atomic: { status: 'unsupported' } },
    }),
    sendCalls: vi.fn().mockResolvedValue({ id: '0xcallid' }),
    waitForCallsStatus: vi.fn().mockResolvedValue({
      status: 'success',
      receipts: [
        {
          transactionHash:
            '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex,
        },
      ],
    }),
    writeContract: vi.fn().mockResolvedValue(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex
    ),
    signMessage: vi.fn().mockResolvedValue('0x' + '22'.repeat(65)),
    signTypedData: vi
      .fn()
      .mockResolvedValue((`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex),
    request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') {
        return '0xa4b1';
      }
      return '0x0';
    }),
    getChainId: vi.fn().mockImplementation(async () => currentEoaChainId),
    switchChain: vi.fn().mockImplementation(async ({ id }: { id: number }) => {
      currentEoaChainId = id;
      return chainList.getChainByID(id);
    }),
    addChain: vi.fn().mockResolvedValue(undefined),
  } as unknown as ScenarioContext['eoaWallet'];

  const ephemeralWallet = {
    address: EPH,
    signMessage: vi.fn().mockResolvedValue('0x' + '33'.repeat(65)),
    signTypedData: vi.fn().mockResolvedValue('0x' + '33'.repeat(65)),
    signAuthorization: vi.fn().mockResolvedValue({
      r: '0x01',
      s: '0x02',
      yParity: 0,
      nonce: 0,
    }),
  } as unknown as PrivateKeyAccount;

  const input = {
    mode: SwapMode.EXACT_OUT as const,
    data: {
      sources:
        scenario.sources ??
        (scenario.balances ?? getDefaultBalances()).map((balance) => ({
          chainId: balance.chainID,
          tokenAddress: balance.tokenAddress,
        })),
      toChainId: BASE_CHAIN,
      toTokenAddress: scenario.destinationTokenAddress,
      toAmountRaw: scenario.destinationAmountRaw,
      ...(scenario.toNativeAmountRaw !== 0n
        ? { toNativeAmountRaw: scenario.toNativeAmountRaw }
        : {}),
    },
  };

  const params: SwapParams = {
    chainList,
    eoaWallet,
    eoaAddress: EOA,
    ephemeralWallet,
    middlewareClient,
    intentExplorerUrl: 'https://intent.example',
    emit: (event) => {
      emittedEvents.push(event);
    },
    onIntent: ({ intent, allow }) => {
      capturedIntent.current = intent;
      allow();
    },
    cotCurrencyId: 1 as SwapParams['cotCurrencyId'],
  };

  return {
    chainList,
    middlewareClient,
    eoaWallet,
    ephemeralWallet,
    params,
    input,
    emittedEvents,
    capturedIntent,
  };
};

const runScenario = async (scenario: ExactOutScenario): Promise<HarnessResult> => {
  const ctx = makeScenario(scenario);

  hoisted.readContract.mockImplementation(async ({ address, functionName }: { address: Hex; functionName: string }) => {
    const normalized = address.toLowerCase();
    if (functionName === 'decimals') {
      return tokenInfoByAddress(address).decimals;
    }
    if (functionName === 'symbol') {
      return tokenInfoByAddress(address).symbol;
    }
    if (functionName === 'allowance') {
      return 0n;
    }
    if (functionName === 'name') {
      if (normalized === SOURCE_DAI.toLowerCase()) return 'Dai Stablecoin';
      if (
        normalized === USDC_ARB.toLowerCase() ||
        normalized === USDC_OP.toLowerCase() ||
        normalized === USDC_BASE.toLowerCase()
      ) {
        return 'USD Coin';
      }
      if (normalized === WETH.toLowerCase()) return 'Wrapped Ether';
    }
    if (functionName === 'nonces' || functionName === 'getNonce') {
      return 0n;
    }
    throw new Error(`Unhandled readContract ${functionName} on ${address}`);
  });
  hoisted.multicall.mockImplementation(async ({ contracts }: { contracts: unknown[] }) =>
    contracts.map(() => ({ result: 0n }))
  );
  hoisted.getCode.mockResolvedValue(undefined);
  hoisted.getTransactionCount.mockResolvedValue(0n);
  hoisted.waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => ({
    status: 'success',
    transactionHash: hash,
  }));
  hoisted.simulateContract.mockImplementation(async ({ address, args, chain, value, account }: any) => ({
    request: {
      address,
      args,
      chain,
      functionName: 'deposit',
      value,
      account,
    },
  }));
  hoisted.watchContractEvent.mockImplementation(() => () => undefined);

  const preflight = await buildSwapPreflight(ctx.input, {
    chainList: ctx.chainList,
    cotCurrencyId: ctx.params.cotCurrencyId,
    eoaAddress: ctx.params.eoaAddress,
    middlewareClient: ctx.middlewareClient,
  });

  const previewState = await buildSwapPreviewState(ctx.input, {
    chainList: ctx.chainList,
    eoaAddress: ctx.params.eoaAddress,
    ephemeralWallet: ctx.params.ephemeralWallet,
    cotCurrencyId: ctx.params.cotCurrencyId,
    middlewareClient: ctx.middlewareClient,
    forceMayan: false,
    preflight,
  });

  const preparedExecution = await prepareSwapExecution({
    chainList: ctx.chainList,
    route: previewState.route,
    source: previewState.route.source,
    destination: previewState.route.destination,
    eoaAddress: ctx.params.eoaAddress,
    eoaWallet: ctx.params.eoaWallet,
    ephemeralWallet: ctx.params.ephemeralWallet,
    publicClientList: preflight.publicClientList,
    cache: new SwapCache(ctx.chainList),
  });

  ctx.eoaWallet.sendCalls.mockClear();
  ctx.eoaWallet.waitForCallsStatus.mockClear();
  ctx.eoaWallet.writeContract.mockClear();
  ctx.middlewareClient.submitSBCs.mockClear();
  ctx.middlewareClient.submitRFF.mockClear();
  ctx.middlewareClient.getRFF.mockClear();
  ctx.emittedEvents.length = 0;
  ctx.capturedIntent.current = null;

  const swapResult = await runSwap(ctx.input, ctx.params);

  const submitSbcChainIds = ctx.middlewareClient.submitSBCs.mock.calls.flatMap(([txs]) =>
    extractSbcChainIds(txs)
  );

  return {
    ...ctx,
    preflight,
    previewState,
    preparedExecution,
    swapResult,
    submitSbcChainIds,
  };
};

const assertScenario = (scenario: ExactOutScenario, result: HarnessResult) => {
  expect(result.previewState.route.source.swaps.map((entry) => entry.chainID)).toEqual(
    scenario.expected.sourceSwapChainIds
  );
  expect(
    result.previewState.route.source.swaps.map((entry) => ({
      chainId: entry.chainID,
      aggregator: entry.aggregator.constructor.name as 'BebopAggregator' | 'LiFiAggregator',
    }))
  ).toEqual(scenario.expected.sourceSwapAggregators);

  if (scenario.expected.expectedDestinationAggregator) {
    expect(result.previewState.route.destination.swap.tokenSwap?.aggregator.constructor.name).toBe(
      scenario.expected.expectedDestinationAggregator
    );
  } else {
    expect(result.previewState.route.destination.swap.tokenSwap).toBeNull();
  }

  expect(result.previewState.route.sourceExecutionPaths).toEqual(
    new Map(scenario.expected.sourceExecutionPaths)
  );
  expect(result.previewState.plan.hasBridge).toBe(scenario.expected.hasBridge);
  // Destination swap step fires when either a token swap or a gas swap is required.
  const expectsAnyDestinationSwap =
    scenario.expected.expectsDestinationSwap || scenario.toNativeAmountRaw > 0n;
  expect(result.previewState.plan.hasDestinationSwap).toBe(expectsAnyDestinationSwap);
  expect(result.previewState.route.bridge === null).toBe(!scenario.expected.hasBridge);

  if (scenario.expected.hasBridge) {
    expect(result.previewState.route.bridge).not.toBeNull();
    for (const expectedAsset of scenario.expected.bridgeAssetOwnership) {
      const actualAsset = result.previewState.route.bridge?.assets.find(
        (asset) => asset.chainID === expectedAsset.chainId
      );
      expect(actualAsset).toBeDefined();
      expect(actualAsset?.eoaBalance.gt(0)).toBe(expectedAsset.hasEoaBalance);
      expect(actualAsset?.ephemeralBalance.gt(0)).toBe(expectedAsset.hasEphemeralBalance);
      expect(getSwapBridgeDepositStep(result.previewState.plan, expectedAsset.chainId).asset.symbol).toBe(
        'USDC'
      );
    }
    expect(getSwapBridgeIntentSubmissionStep(result.previewState.plan).type).toBe(
      'bridge_intent_submission'
    );
    expect(getSwapBridgeFillStep(result.previewState.plan).chain.id).toBe(BASE_CHAIN);
  } else {
    expect(
      result.previewState.plan.steps.find((step) => step.type === 'bridge_intent_submission')
    ).toBeUndefined();
  }

  for (const [chainId, walletPath] of scenario.expected.sourceExecutionPaths) {
    if (!scenario.expected.sourceSwapChainIds.includes(chainId)) continue;
    expect(getSwapSourceSwapStep(result.previewState.plan, chainId).walletPath).toBe(walletPath);
  }
  if (expectsAnyDestinationSwap) {
    // Destination wrapper depends on the chain's 7702 support, not a per-route field.
    const expectedDstWrapper = scenario.destinationHas7702 ? 'ephemeral' : 'safe';
    expect(getSwapDestinationSwapStep(result.previewState.plan, BASE_CHAIN).walletPath).toBe(
      expectedDstWrapper
    );
  } else {
    expect(
      result.previewState.plan.steps.find((step) => step.type === 'destination_swap')
    ).toBeUndefined();
  }
  const bridgeTransferChainIds = result.previewState.plan.steps
    .filter((step) => step.type === 'eoa_to_ephemeral_transfer')
    .map((step) => step.chain.id)
    .sort((left, right) => left - right);
  // Smart-account-only model: EOA → ephemeral transfer fires for any bridge asset that has
  // an eoaBalance > 0 (bridge funding flows through the ephemeral).
  expect(bridgeTransferChainIds).toEqual(
    scenario.expected.bridgeAssetOwnership
      .filter((asset) => asset.hasEoaBalance)
      .map((asset) => asset.chainId)
      .sort((left, right) => left - right)
  );

  const usedCotChainIds = result.previewState.route.extras.assetsUsed
    .filter((asset) =>
      [USDC_ARB.toLowerCase(), USDC_OP.toLowerCase(), USDC_BASE.toLowerCase()].includes(
        asset.tokenAddress.toLowerCase()
      )
    )
    .map((asset) => asset.chainID)
    .sort((left, right) => left - right);
  expect(usedCotChainIds).toEqual(
    [...scenario.expected.directCotChains].sort((left, right) => left - right)
  );

  // Gas via destination aggregator: when toNativeAmount > 0n, the route quotes a gas swap
  // (COT → native, receiver = EOA) inside the destination batch. Bridge `gasInCot` is the
  // COT input to that gas swap; intent's gas amount reflects the swap's native output.
  if (scenario.toNativeAmountRaw > 0n) {
    expect(result.previewState.route.destination.swap.gasSwap).not.toBeNull();
    expect(result.previewState.route.bridge?.amounts.gasInCot.gt(0) ?? true).toBe(true);
    expect(
      Number(result.previewState.intent.destination.gas.amount)
    ).toBeGreaterThan(0);
  } else {
    expect(result.previewState.route.destination.swap.gasSwap).toBeNull();
    expect(result.previewState.route.bridge?.amounts.gasInCot.eq(0) ?? true).toBe(true);
    expect(result.previewState.intent.destination.gas.amount).toBe('0');
  }

  const baseLiFiCalls = getLiFiCallsForChain(result.middlewareClient, BASE_CHAIN);
  const baseBebopCalls = getBebopCallsForChain(result.middlewareClient, BASE_CHAIN);

  if (expectsAnyDestinationSwap) {
    expect(baseLiFiCalls.length + baseBebopCalls.length).toBeGreaterThan(0);
  } else {
    expect(baseLiFiCalls).toHaveLength(0);
    expect(baseBebopCalls).toHaveLength(0);
  }

  for (const expectation of scenario.expected.sourceQuoteExpectations) {
    const bebopCalls = getBebopCallsForChain(result.middlewareClient, expectation.chainId);
    const lifiCalls = getLiFiCallsForChain(result.middlewareClient, expectation.chainId);
    if (bebopCalls.length > 0) {
      expect(bebopCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taker_address: getAddress(expectation.executor),
            receiver_address: getAddress(expectation.recipient),
          }),
        ])
      );
    }
    if (lifiCalls.length > 0) {
      expect(lifiCalls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({
              fromAddress: expectation.executor,
              toAddress: expectation.recipient,
            }),
            false,
          ],
        ])
      );
    }
  }

  if (scenario.expected.destinationQuoteExpectation) {
    if (baseBebopCalls.length > 0) {
      expect(baseBebopCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taker_address: getAddress(scenario.expected.destinationQuoteExpectation.executor),
            receiver_address: getAddress(scenario.expected.destinationQuoteExpectation.recipient),
          }),
        ])
      );
    }
    if (baseLiFiCalls.length > 0) {
      expect(baseLiFiCalls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({
              fromAddress: scenario.expected.destinationQuoteExpectation.executor,
              toAddress: scenario.expected.destinationQuoteExpectation.recipient,
            }),
            expect.anything(),
          ],
        ])
      );
    }
  }

  // parsedQuotes covers each source-swap quote, plus an entry per destination-side quote
  // that actually ran (token swap + gas swap).
  const expectsGasSwap = scenario.toNativeAmountRaw > 0n;
  const expectedDstQuoteCount =
    (scenario.expected.expectsDestinationSwap ? 1 : 0) + (expectsGasSwap ? 1 : 0);
  expect(result.preparedExecution.parsedQuotes).toHaveLength(
    scenario.expected.sourceSwapChainIds.length + expectedDstQuoteCount
  );
  const expectedRouters = [
    ...scenario.expected.sourceSwapAggregators.map(({ chainId, aggregator }) =>
      aggregator === 'BebopAggregator'
        ? chainId === ARB_CHAIN
          ? ARB_BEBOP_ROUTER
          : BASE_BEBOP_ROUTER
        : chainId === OP_CHAIN
          ? OP_LIFI_ROUTER
          : BASE_LIFI_ROUTER
    ),
    ...(scenario.expected.expectedDestinationAggregator
      ? [
          scenario.expected.expectedDestinationAggregator === 'BebopAggregator'
            ? BASE_BEBOP_ROUTER
            : BASE_LIFI_ROUTER,
        ]
      : []),
  ];
  expect(result.preparedExecution.parsedQuotes.map((entry) => entry.quote.txData.tx.to)).toEqual(
    expect.arrayContaining(expectedRouters)
  );
  expect(
    result.preparedExecution.eoaToEphemeralTransfers.map((transfer) => ({
      reason: transfer.reason,
      chainId: transfer.chainId,
      tokenAddress: transfer.tokenAddress,
    }))
  ).toEqual(expect.arrayContaining(scenario.expected.eoaToEphemeralTransfers));

  expect(result.capturedIntent.current).toEqual(result.previewState.intent);
  expectStatusSequence(result.emittedEvents);
  expect(result.emittedEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'plan_preview', plan: result.previewState.plan }),
      expect.objectContaining({ type: 'plan_confirmed', plan: result.previewState.plan }),
    ])
  );

  // Smart-account-only model: the EOA never dispatches swap routers directly. All swap
  // calldata flows through the per-chain wrapper (Calibur SBC on 7702, Safe on non-7702),
  // so the EOA never lands on a known aggregator router via writeContract/sendCalls.
  const eoaCalls = flattenEoaCalls(result.eoaWallet);
  const eoaCallTargets = eoaCalls.map((call) => call.to);
  expect(eoaCallTargets).not.toEqual(
    expect.arrayContaining([ARB_BEBOP_ROUTER, OP_LIFI_ROUTER, BASE_BEBOP_ROUTER])
  );

  // Source SBC chains = each ephemeral source chain, plus the dst chain if any dst swap runs.
  const expectedSbcChainIds = new Set<number>(
    scenario.expected.sourceExecutionPaths
      .filter(([, walletPath]) => walletPath === 'ephemeral')
      .map(([chainId]) => chainId)
  );
  if (expectsAnyDestinationSwap && scenario.destinationHas7702) {
    expectedSbcChainIds.add(BASE_CHAIN);
  }
  expect(new Set(result.submitSbcChainIds)).toEqual(expectedSbcChainIds);
  if (scenario.expected.hasBridge) {
    expect(result.middlewareClient.submitRFF).toHaveBeenCalledTimes(1);
    const submitRffPayload = result.middlewareClient.submitRFF.mock.calls[0]?.[0] as {
      request: { recipient_address: Hex };
    };
    // Bridge recipient derives from the destination shape: no dst swap → EOA; 7702 + swap →
    // ephemeral; non-7702 + swap → Safe.
    const expectedRecipient: Hex = !expectsAnyDestinationSwap
      ? EOA
      : scenario.destinationHas7702
        ? EPH
        : (predictSafeAccountAddress(EPH).address as Hex);
    expect(submitRffPayload.request.recipient_address).toBe(
      toBytes32Address(expectedRecipient)
    );
  } else {
    expect(result.middlewareClient.submitRFF).not.toHaveBeenCalled();
  }
  // Aggregator delivers native straight to the EOA on the gas-swap path — no Calibur
  // `sweepERC7914` ever fires for the swap flow, even when gas was requested.
  const baseSbcCalls = getSubmittedSbcCallsForChain(result.middlewareClient, BASE_CHAIN);
  const sweeperFunctions = baseSbcCalls
    .filter((call) => call.to.toLowerCase() === SWEEPER_ADDRESS.toLowerCase())
    .map((call) => decodeFunctionData({ abi: SWEEPER_ABI, data: call.data }).functionName);
  expect(sweeperFunctions).not.toContain('sweepERC7914');

  expect(result.swapResult.sourceSwaps).toHaveLength(scenario.expected.sourceSwapChainIds.length);
  expect(result.swapResult.sourceSwaps.map((entry) => entry.chainId)).toEqual(
    expect.arrayContaining(scenario.expected.sourceSwapChainIds)
  );
  expect(result.swapResult.destinationSwap?.chainId ?? null).toBe(
    expectsAnyDestinationSwap ? BASE_CHAIN : null
  );
  if (scenario.expected.hasBridge) {
    expect(result.swapResult.intentExplorerUrl).toMatch(
      /^https:\/\/intent\.example\/rff\/0x[0-9a-f]+$/i
    );
  } else {
    expect(result.swapResult.intentExplorerUrl).toBe('');
  }
};

describe('swap pipeline characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(SCENARIOS)('$name', async (scenario) => {
    const result = await runScenario(scenario);
    assertScenario(scenario, result);
  });

  it('normalizes a negative destination gas reserve and deducts the reserved native balance before source selection', async () => {
    const placeholder = SCENARIOS.find(
      (entry) => entry.name === 'same-chain direct COT exact-out does destination handoff without bridge'
    );
    if (!placeholder) {
      throw new Error('same-chain destination scenario not found');
    }

    const scenario: ExactOutScenario = {
      ...placeholder,
      name: 'same-chain native reserve exact-out',
      balances: [
        {
          amount: '1',
          chainID: BASE_CHAIN,
          decimals: 18,
          symbol: 'ETH',
          tokenAddress: EADDRESS as Hex,
          value: 3000,
          name: 'ETH',
          logo: '',
        },
      ],
      sources: [{ chainId: BASE_CHAIN, tokenAddress: EADDRESS as Hex }],
      destinationTokenAddress: USDC_BASE,
      destinationAmountRaw: parseUnits('2996', 6),
      toNativeAmountRaw: -parseUnits('0.00024', 18),
    };

    const result = await runScenario(scenario);
    const reservedNative = result.previewState.route.extras.balances.find(
      (balance) =>
        balance.chainID === BASE_CHAIN &&
        balance.tokenAddress.toLowerCase() === EADDRESS.toLowerCase()
    );

    // Negative `toNativeAmountRaw` is a reservation, not a positive shortfall, so no gas swap
    // is quoted at the destination — `gasSwap` stays null and `gas.amount` is '0'.
    expect(result.previewState.route.destination.swap.gasSwap).toBeNull();
    expect(reservedNative?.amount).toBe('0.99976');
    expect(result.previewState.route.source.swaps.map((entry) => entry.chainID)).toEqual([
      BASE_CHAIN,
    ]);
    expect(result.capturedIntent.current?.destination.gas.amount).toBe('0');
  });

  it('ephemeral-preferred materializes source permits during source execution and keeps them inside the source SBC batch', async () => {
    const scenario = SCENARIOS.find(
      (entry) => entry.name === 'ephemeral-preferred uses ephemeral execution end-to-end where supported'
    );
    if (!scenario) {
      throw new Error('ephemeral-preferred scenario not found');
    }

    const result = await runScenario(scenario);
    const sourceTransfers = result.preparedExecution.eoaToEphemeralTransfers.filter(
      (transfer) => transfer.reason === 'source'
    );

    expect(sourceTransfers.length).toBeGreaterThan(0);

    for (const transfer of sourceTransfers) {
      expect(transfer.authorization?.kind).toBe('permit');
      expect(transfer.authorization?.call).toBeNull();

      const sbcCalls = getSubmittedSbcCallsForChain(result.middlewareClient, transfer.chainId);
      const tokenCallNames = sbcCalls
        .filter((call) => call.to.toLowerCase() === transfer.tokenAddress.toLowerCase())
        .map((call) => decodeTokenFunctionName(call.data));

      expect(tokenCallNames).toEqual(
        expect.arrayContaining(['permit', 'transferFrom', 'approve'])
      );
    }

    expect(result.eoaWallet.writeContract).not.toHaveBeenCalled();
  });

  it('same-chain direct COT exact-out keeps the destination permit and transferFrom inside the destination SBC batch', async () => {
    const scenario = SCENARIOS.find(
      (entry) => entry.name === 'same-chain direct COT exact-out does destination handoff without bridge'
    );
    if (!scenario) {
      throw new Error('same-chain destination scenario not found');
    }

    const result = await runScenario(scenario);
    const destinationTransfer = result.preparedExecution.eoaToEphemeralTransfers.find(
      (transfer) => transfer.reason === 'destination'
    );

    expect(destinationTransfer?.authorization?.kind).toBe('permit');
    expect(destinationTransfer?.authorization?.call).not.toBeNull();

    const sbcCalls = getSubmittedSbcCallsForChain(result.middlewareClient, BASE_CHAIN);
    const tokenCallNames = sbcCalls
      .filter(
        (call) =>
          call.to.toLowerCase() === destinationTransfer?.tokenAddress.toLowerCase()
      )
      .map((call) => decodeTokenFunctionName(call.data));

    expect(tokenCallNames).toEqual(
      expect.arrayContaining(['permit', 'transferFrom', 'approve'])
    );
    expect(result.eoaWallet.writeContract).not.toHaveBeenCalled();
  });
});

type ExactInScenario = {
  name: string;
  destinationHas7702: boolean;
  balances?: FlatBalance[];
  sources?: Array<{ chainId: number; tokenAddress: Hex; amountRaw?: bigint }>;
  destinationTokenAddress: Hex;
  expected: {
    sourceSwapChainIds: number[];
    sourceSwapAggregators: Array<{ chainId: number; aggregator: 'BebopAggregator' | 'LiFiAggregator' }>;
    sourceExecutionPaths: Array<[number, WalletPath]>;
    hasBridge: boolean;
    expectedDestinationAggregator: 'BebopAggregator' | 'LiFiAggregator';
    expectedSendCallsCount: number;
    expectedEoaRouters: Hex[];
    expectedSubmitSbcChainIds: number[];
    expectedBridgeRecipient: Hex;
    expectedBridgeAmountHuman: string;
    expectedDestinationInputHuman: string;
    sourceQuoteExpectations: Array<{
      chainId: number;
      executor: Hex;
      recipient: Hex;
    }>;
    destinationQuoteExpectation: {
      executor: Hex;
      recipient: Hex;
    };
    eoaToEphemeralTransfers: Array<{
      reason: 'source' | 'bridge' | 'destination';
      chainId: number;
      tokenAddress: Hex;
    }>;
    bridgeAssetOwnership: Array<{
      chainId: number;
      hasEoaBalance: boolean;
      hasEphemeralBalance: boolean;
    }>;
  };
};

type ExactInScenarioContext = Omit<ScenarioContext, 'input'> & {
  input: {
    mode: SwapMode.EXACT_IN;
    data: {
      sources: Array<{ chainId: number; tokenAddress: Hex; amountRaw?: bigint }>;
      toChainId: number;
      toTokenAddress: Hex;
    };
  };
};

type ExactInHarnessResult = Omit<HarnessResult, 'input'> & {
  input: ExactInScenarioContext['input'];
};

const EXACT_IN_SCENARIOS: ExactInScenario[] = [
  {
    name: 'cross-chain non-COT exact-in uses real liquidation, bridge, and destination swap pipeline',
    destinationHas7702: true,
    destinationTokenAddress: WETH,
    expected: {
      sourceSwapChainIds: [ARB_CHAIN, OP_CHAIN],
      sourceSwapAggregators: [
        { chainId: ARB_CHAIN, aggregator: 'BebopAggregator' },
        { chainId: OP_CHAIN, aggregator: 'LiFiAggregator' },
      ],
      sourceExecutionPaths: [
        [ARB_CHAIN, 'ephemeral'],
        [OP_CHAIN, 'ephemeral'],
      ],
      hasBridge: true,
      expectedDestinationAggregator: 'BebopAggregator',
      expectedSendCallsCount: 1,
      expectedEoaRouters: [ARB_BEBOP_ROUTER],
      expectedSubmitSbcChainIds: [ARB_CHAIN, OP_CHAIN, BASE_CHAIN],
      expectedBridgeRecipient: EPH,
      expectedBridgeAmountHuman: '2100',
      // 2100 source-swap output × 0.005 = 10.5, capped to $1 → dst quote runs on 2099.
      expectedDestinationInputHuman: '2099',
      sourceQuoteExpectations: [
        { chainId: ARB_CHAIN, executor: EPH, recipient: EPH },
        { chainId: OP_CHAIN, executor: EPH, recipient: EPH },
      ],
      destinationQuoteExpectation: { executor: EPH, recipient: EOA },
      eoaToEphemeralTransfers: [
        { reason: 'source', chainId: OP_CHAIN, tokenAddress: SOURCE_DAI },
      ],
      bridgeAssetOwnership: [
        { chainId: ARB_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
        { chainId: OP_CHAIN, hasEoaBalance: false, hasEphemeralBalance: true },
      ],
    },
  },
];

const makeExactInScenario = (scenario: ExactInScenario): ExactInScenarioContext => {
  const chainList = makeChainList(scenario.destinationHas7702);
  const emittedEvents: SwapEvent[] = [];
  const capturedIntent = { current: null as SwapIntent | null };
  let currentEoaChainId = ARB_CHAIN;

  const middlewareClient = {
    getSwapBalances: vi.fn().mockResolvedValue(scenario.balances ?? getDefaultBalances()),
    getOraclePrices: vi.fn().mockResolvedValue([
      {
        universe: 'EVM' as const,
        chainId: BASE_CHAIN,
        tokenAddress: '0x0000000000000000000000000000000000000000' as Hex,
        tokenSymbol: 'ETH',
        tokenDecimals: 18,
        priceUsd: new Decimal(3000),
        timestamp: 1,
      },
      {
        universe: 'EVM' as const,
        chainId: BASE_CHAIN,
        tokenAddress: USDC_BASE,
        tokenSymbol: 'USDC',
        tokenDecimals: 6,
        priceUsd: new Decimal(1),
        timestamp: 1,
      },
    ]),
    getLiFiQuote: vi.fn().mockImplementation(async (params: Record<string, string>, exactOut?: boolean) =>
      makeLiFiResponse(params, Boolean(exactOut))
    ),
    getBebopQuote: vi.fn().mockImplementation(async (params: Record<string, string>) =>
      makeBebopResponse(params)
    ),
    getQuote: vi.fn().mockResolvedValue(makeBridgeQuoteResponse()),
    getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'nexus' }),
    getMayanQuotes: vi.fn(),
    submitSBCs: vi.fn().mockImplementation(async (txs: Array<{ chainId: number; address: Hex }>) =>
      txs.map((tx, index) => ({
        chainId: tx.chainId,
        address: tx.address,
        errored: false as const,
        txHash: (`0x${(index + 1).toString(16).padStart(64, '0')}`) as Hex,
      }))
    ),
    submitRFF: vi.fn().mockResolvedValue({
      request_hash: '0x9999999999999999999999999999999999999999999999999999999999999999' as Hex,
    }),
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
      request_hash:
        '0x9999999999999999999999999999999999999999999999999999999999999999' as Hex,
      status: 'fulfilled',
      solver: null,
    }),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'fulfilled' }),
    configureTiming: vi.fn(),
    destroy: vi.fn(),
  } as unknown as ExactInScenarioContext['middlewareClient'];

  const eoaWallet = {
    getCapabilities: vi.fn().mockResolvedValue({
      42161: { atomic: { status: 'supported' } },
      10: { atomic: { status: 'unsupported' } },
      8453: { atomic: { status: 'unsupported' } },
    }),
    sendCalls: vi.fn().mockResolvedValue({ id: '0xcallid' }),
    waitForCallsStatus: vi.fn().mockResolvedValue({
      status: 'success',
      receipts: [
        {
          transactionHash:
            '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex,
        },
      ],
    }),
    writeContract: vi.fn().mockResolvedValue(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex
    ),
    signMessage: vi.fn().mockResolvedValue('0x' + '22'.repeat(65)),
    signTypedData: vi
      .fn()
      .mockResolvedValue((`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex),
    request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') {
        return '0xa4b1';
      }
      return '0x0';
    }),
    getChainId: vi.fn().mockImplementation(async () => currentEoaChainId),
    switchChain: vi.fn().mockImplementation(async ({ id }: { id: number }) => {
      currentEoaChainId = id;
      return chainList.getChainByID(id);
    }),
    addChain: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExactInScenarioContext['eoaWallet'];

  const ephemeralWallet = {
    address: EPH,
    signMessage: vi.fn().mockResolvedValue('0x' + '33'.repeat(65)),
    signTypedData: vi.fn().mockResolvedValue('0x' + '33'.repeat(65)),
    signAuthorization: vi.fn().mockResolvedValue({
      r: '0x01',
      s: '0x02',
      yParity: 0,
      nonce: 0,
    }),
  } as unknown as PrivateKeyAccount;

  const sources =
    scenario.sources ??
    (scenario.balances ?? getDefaultBalances()).map((balance) => ({
      chainId: balance.chainID,
      tokenAddress: balance.tokenAddress,
      amountRaw: parseUnits(balance.amount, balance.decimals),
    }));

  const input = {
    mode: SwapMode.EXACT_IN as const,
    data: {
      sources,
      toChainId: BASE_CHAIN,
      toTokenAddress: scenario.destinationTokenAddress,
    },
  };

  const params: SwapParams = {
    chainList,
    eoaWallet,
    eoaAddress: EOA,
    ephemeralWallet,
    middlewareClient,
    intentExplorerUrl: 'https://intent.example',
    emit: (event) => {
      emittedEvents.push(event);
    },
    onIntent: ({ intent, allow }) => {
      capturedIntent.current = intent;
      allow();
    },
    cotCurrencyId: 1 as SwapParams['cotCurrencyId'],
  };

  return {
    chainList,
    middlewareClient,
    eoaWallet,
    ephemeralWallet,
    params,
    input,
    emittedEvents,
    capturedIntent,
  };
};

const runExactInScenario = async (scenario: ExactInScenario): Promise<ExactInHarnessResult> => {
  const ctx = makeExactInScenario(scenario);

  hoisted.readContract.mockImplementation(async ({ address, functionName }: { address: Hex; functionName: string }) => {
    const normalized = address.toLowerCase();
    if (functionName === 'decimals') {
      return tokenInfoByAddress(address).decimals;
    }
    if (functionName === 'symbol') {
      return tokenInfoByAddress(address).symbol;
    }
    if (functionName === 'allowance') {
      return 0n;
    }
    if (functionName === 'name') {
      if (normalized === SOURCE_DAI.toLowerCase()) return 'Dai Stablecoin';
      if (
        normalized === USDC_ARB.toLowerCase() ||
        normalized === USDC_OP.toLowerCase() ||
        normalized === USDC_BASE.toLowerCase()
      ) {
        return 'USD Coin';
      }
      if (normalized === WETH.toLowerCase()) return 'Wrapped Ether';
    }
    if (functionName === 'nonces' || functionName === 'getNonce') {
      return 0n;
    }
    throw new Error(`Unhandled readContract ${functionName} on ${address}`);
  });
  hoisted.multicall.mockImplementation(async ({ contracts }: { contracts: unknown[] }) =>
    contracts.map(() => ({ result: 0n }))
  );
  hoisted.getCode.mockResolvedValue(undefined);
  hoisted.getTransactionCount.mockResolvedValue(0n);
  hoisted.waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => ({
    status: 'success',
    transactionHash: hash,
  }));
  hoisted.simulateContract.mockImplementation(async ({ address, args, chain, value, account }: any) => ({
    request: {
      address,
      args,
      chain,
      functionName: 'deposit',
      value,
      account,
    },
  }));
  hoisted.watchContractEvent.mockImplementation(() => () => undefined);

  const preflight = await buildSwapPreflight(ctx.input, {
    chainList: ctx.chainList,
    cotCurrencyId: ctx.params.cotCurrencyId,
    eoaAddress: ctx.params.eoaAddress,
    middlewareClient: ctx.middlewareClient,
  });

  const previewState = await buildSwapPreviewState(ctx.input, {
    chainList: ctx.chainList,
    eoaAddress: ctx.params.eoaAddress,
    ephemeralWallet: ctx.params.ephemeralWallet,
    cotCurrencyId: ctx.params.cotCurrencyId,
    middlewareClient: ctx.middlewareClient,
    forceMayan: false,
    preflight,
  });

  const preparedExecution = await prepareSwapExecution({
    chainList: ctx.chainList,
    route: previewState.route,
    source: previewState.route.source,
    destination: previewState.route.destination,
    eoaAddress: ctx.params.eoaAddress,
    eoaWallet: ctx.params.eoaWallet,
    ephemeralWallet: ctx.params.ephemeralWallet,
    publicClientList: preflight.publicClientList,
    cache: new SwapCache(ctx.chainList),
  });

  ctx.eoaWallet.sendCalls.mockClear();
  ctx.eoaWallet.waitForCallsStatus.mockClear();
  ctx.eoaWallet.writeContract.mockClear();
  ctx.middlewareClient.submitSBCs.mockClear();
  ctx.middlewareClient.submitRFF.mockClear();
  ctx.middlewareClient.getRFF.mockClear();
  ctx.emittedEvents.length = 0;
  ctx.capturedIntent.current = null;

  const swapResult = await runSwap(ctx.input, ctx.params);

  const submitSbcChainIds = ctx.middlewareClient.submitSBCs.mock.calls.flatMap(([txs]) =>
    extractSbcChainIds(txs)
  );

  return {
    ...ctx,
    preflight,
    previewState,
    preparedExecution,
    swapResult,
    submitSbcChainIds,
  };
};

const assertExactInScenario = (scenario: ExactInScenario, result: ExactInHarnessResult) => {
  expect(result.previewState.route.type).toBe(SwapMode.EXACT_IN);
  expect(result.previewState.route.source.swaps.map((entry) => entry.chainID)).toEqual(
    scenario.expected.sourceSwapChainIds
  );
  expect(
    result.previewState.route.source.swaps.map((entry) => ({
      chainId: entry.chainID,
      aggregator: entry.aggregator.constructor.name as 'BebopAggregator' | 'LiFiAggregator',
    }))
  ).toEqual(scenario.expected.sourceSwapAggregators);
  expect(result.previewState.route.sourceExecutionPaths).toEqual(
    new Map(scenario.expected.sourceExecutionPaths)
  );
  expect(result.previewState.route.bridge).not.toBeNull();
  expect(result.previewState.route.destination.swap.tokenSwap?.aggregator.constructor.name).toBe(
    scenario.expected.expectedDestinationAggregator
  );
  expect(result.previewState.route.destination.swap.gasSwap).toBeNull();
  expect(result.previewState.route.destination.inputAmount.min.toFixed()).toBe(
    scenario.expected.expectedDestinationInputHuman
  );
  // EXACT_IN reclaim lifts `max` to the full unbuffered COT (= the bridged amount) so the
  // execution-time re-size can spend up to what actually lands; `min` stays the buffered floor.
  expect(result.previewState.route.destination.inputAmount.max.toFixed()).toBe(
    scenario.expected.expectedBridgeAmountHuman
  );
  expect(result.previewState.route.bridge?.amount.toFixed()).toBe(
    scenario.expected.expectedBridgeAmountHuman
  );
  expect(result.previewState.route.bridge?.amounts.totalAmount.toFixed()).toBe(
    scenario.expected.expectedBridgeAmountHuman
  );
  expect(result.previewState.plan.hasBridge).toBe(scenario.expected.hasBridge);
  expect(result.previewState.plan.hasDestinationSwap).toBe(true);

  for (const expectedAsset of scenario.expected.bridgeAssetOwnership) {
    const actualAsset = result.previewState.route.bridge?.assets.find(
      (asset) => asset.chainID === expectedAsset.chainId
    );
    expect(actualAsset).toBeDefined();
    expect(actualAsset?.eoaBalance.gt(0)).toBe(expectedAsset.hasEoaBalance);
    expect(actualAsset?.ephemeralBalance.gt(0)).toBe(expectedAsset.hasEphemeralBalance);
    expect(getSwapBridgeDepositStep(result.previewState.plan, expectedAsset.chainId).asset.symbol).toBe(
      'USDC'
    );
  }
  expect(getSwapBridgeFillStep(result.previewState.plan).chain.id).toBe(BASE_CHAIN);
  const exactInExpectedDstWrapper = scenario.destinationHas7702 ? 'ephemeral' : 'safe';
  expect(getSwapDestinationSwapStep(result.previewState.plan, BASE_CHAIN).walletPath).toBe(
    exactInExpectedDstWrapper
  );

  for (const expectation of scenario.expected.sourceQuoteExpectations) {
    const bebopCalls = getBebopCallsForChain(result.middlewareClient, expectation.chainId);
    const lifiCalls = getLiFiCallsForChain(result.middlewareClient, expectation.chainId);
    if (bebopCalls.length > 0) {
      expect(bebopCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taker_address: getAddress(expectation.executor),
            receiver_address: getAddress(expectation.recipient),
          }),
        ])
      );
    }
    if (lifiCalls.length > 0) {
      expect(lifiCalls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({
              fromAddress: expectation.executor,
              toAddress: expectation.recipient,
            }),
            false,
          ],
        ])
      );
    }
  }

  const baseBebopCalls = getBebopCallsForChain(result.middlewareClient, BASE_CHAIN);
  expect(baseBebopCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        taker_address: getAddress(scenario.expected.destinationQuoteExpectation.executor),
        receiver_address: getAddress(scenario.expected.destinationQuoteExpectation.recipient),
      }),
    ])
  );

  expect(result.preparedExecution.parsedQuotes).toHaveLength(
    scenario.expected.sourceSwapChainIds.length + 1
  );
  expect(
    result.preparedExecution.eoaToEphemeralTransfers.map((transfer) => ({
      reason: transfer.reason,
      chainId: transfer.chainId,
      tokenAddress: transfer.tokenAddress,
    }))
  ).toEqual(expect.arrayContaining(scenario.expected.eoaToEphemeralTransfers));
  expectStatusSequence(result.emittedEvents);
  // Smart-account-only: EOA never targets a known aggregator router directly.
  const eoaCalls = flattenEoaCalls(result.eoaWallet);
  const eoaCallTargets = eoaCalls.map((call) => call.to);
  expect(eoaCallTargets).not.toEqual(
    expect.arrayContaining([ARB_BEBOP_ROUTER, OP_LIFI_ROUTER, BASE_BEBOP_ROUTER])
  );
  // SBC chains = each ephemeral source chain + dst chain.
  const exactInExpectedSbcChainIds = new Set<number>(
    scenario.expected.sourceExecutionPaths
      .filter(([, walletPath]) => walletPath === 'ephemeral')
      .map(([chainId]) => chainId)
  );
  if (scenario.destinationHas7702) {
    exactInExpectedSbcChainIds.add(BASE_CHAIN);
  }
  expect(new Set(result.submitSbcChainIds)).toEqual(exactInExpectedSbcChainIds);
  expect(result.middlewareClient.submitRFF).toHaveBeenCalledTimes(1);
  const submitRffPayload = result.middlewareClient.submitRFF.mock.calls[0]?.[0] as {
    request: { recipient_address: Hex };
  };
  const exactInExpectedRecipient: Hex = scenario.destinationHas7702
    ? EPH
    : (predictSafeAccountAddress(EPH).address as Hex);
  expect(submitRffPayload.request.recipient_address).toBe(toBytes32Address(exactInExpectedRecipient));
  expect(result.swapResult.sourceSwaps).toHaveLength(scenario.expected.sourceSwapChainIds.length);
  expect(result.swapResult.destinationSwap?.chainId).toBe(BASE_CHAIN);
  expect(result.swapResult.intentExplorerUrl).toMatch(
    /^https:\/\/intent\.example\/rff\/0x[0-9a-f]+$/i
  );
};

describe('swap exact-in pipeline characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(EXACT_IN_SCENARIOS)('$name', async (scenario) => {
    const result = await runExactInScenario(scenario);
    assertExactInScenario(scenario, result);
  });
});
