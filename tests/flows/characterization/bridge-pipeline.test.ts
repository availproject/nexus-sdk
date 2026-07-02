import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { BridgeIntentDraft, BridgeOptions } from '../../../src/domain';
import { Universe } from '../../../src/domain';
import {
  executeBridge as executeBridgeWithDeps,
} from '../../../src/flows/bridge';
import { createChainList } from '../../../src/services/chain-list';
import { makeMiddlewareClient } from '../../helpers/middleware-client';
import { testDeployment } from '../../fixtures/deployment';
import { BridgeDeps } from '../../../src/flows/deps';

const mockCreatePublicClientWithFallback = vi.hoisted(() => vi.fn());
const mockWatchContractEvent = vi.hoisted(() => vi.fn());
const mockSimulateContract = vi.hoisted(() => vi.fn());

const buildBridgeIntent = vi.fn();
const findInsufficientAllowanceSources = vi.fn();
const getAllowances = vi.fn();
const createRequestFromIntent = vi.fn();
const convertIntent = vi.fn((intent: BridgeIntentDraft) => ({ id: intent.recipientAddress }));
const requestTimeout = vi.fn(() => Promise.resolve());
const switchChain = vi.fn(() => Promise.resolve());
const waitForIntentFulfilment = vi.fn(() => Promise.resolve('ok'));
const waitForIntentFulfilmentFromMiddleware = vi.fn(() => Promise.resolve());
const NATIVE_TOKEN = {
  contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
  decimals: 18,
  logo: '',
  name: 'Ether',
  symbol: 'ETH',
};
const makeChainDisplay = (chainId: number) => ({
  id: chainId,
  name: `Chain ${chainId}`,
  logo: `chain-${chainId}.png`,
});

vi.mock('../../../src/bridge/intent/builder', () => ({
  buildBridgeIntent: (...args: any[]) => (buildBridgeIntent as (...inner: any[]) => any)(...args),
  findInsufficientAllowanceSources: (...args: any[]) =>
    (findInsufficientAllowanceSources as (...inner: any[]) => any)(...args),
}));

vi.mock('../../../src/services/allowance-utils', () => ({
  getAllowances: (...args: any[]) => (getAllowances as (...inner: any[]) => any)(...args),
}));

vi.mock('../../../src/services/rff', () => ({
  createRequestFromIntent: (...args: any[]) =>
    (createRequestFromIntent as (...inner: any[]) => any)(...args),
}));

vi.mock('../../../src/bridge/intent/readable', () => ({
  convertIntent: (...args: any[]) => (convertIntent as (...inner: any[]) => any)(...args),
}));

vi.mock('../../../src/services/evm', () => ({
  requestTimeout: (...args: any[]) => (requestTimeout as (...inner: any[]) => any)(...args),
  switchChain: (...args: any[]) => (switchChain as (...inner: any[]) => any)(...args),
  createPublicClientWithFallback: (...args: any[]) =>
    (mockCreatePublicClientWithFallback as (...inner: any[]) => any)(...args),
  waitForTxReceipt: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/services/fulfilment', () => ({
  waitForIntentFulfilment: (...args: any[]) =>
    (waitForIntentFulfilment as (...inner: any[]) => any)(...args),
  waitForIntentFulfilmentFromMiddleware: (...args: any[]) =>
    (waitForIntentFulfilmentFromMiddleware as (...inner: any[]) => any)(...args),
}));

const makeIntent = (input: {
  chainId: number;
  token: {
    contractAddress: `0x${string}`;
    decimals: number;
    logo: string;
    name: string;
    symbol: string;
  };
  recipientAddress: `0x${string}`;
  sources?: BridgeIntentDraft['selectedSources'];
}): BridgeIntentDraft => ({
  availableSources: input.sources ?? [],
  selectedSources: input.sources ?? [],
  destination: {
    amount: new Decimal(1),
    amountRaw: 1n,
    nativeAmount: new Decimal(0),
    nativeAmountRaw: 0n,
    nativeAmountValue: new Decimal(0),
    nativeAmountInToken: new Decimal(0),
    nativeToken: NATIVE_TOKEN,
    chain: makeChainDisplay(input.chainId),
    token: input.token,
    universe: Universe.ETHEREUM,
    value: new Decimal(0),
  },
  fees: {
    caGas: '0',
    deposit: '0',
    fulfillment: '0',
    protocol: '0',
    solver: '0',
  },
  recipientAddress: input.recipientAddress,
  provider: 'nexus',
});

const FAKE_VAULT_ADDRESS = '0x0000000000000000000000000000000000000000';

const makeOptions = (chainList: ReturnType<typeof createChainList>): BridgeOptions => ({
  evm: {
    address: '0x0000000000000000000000000000000000000001',
    client: {} as never,
    provider: {} as never,
  },
  hooks: {
    onAllowance: () => {},
    onIntent: () => {},
  },
  intentExplorerUrl: 'https://example.com',
  chainList,
  middlewareClient: makeMiddlewareClient(),
});

const toBridgeDeps = (options: BridgeOptions): BridgeDeps => ({
  chainList: options.chainList,
  timing: options.timing,
  intentExplorerUrl: options.intentExplorerUrl,
  middlewareClient: options.middlewareClient,
  evm: {
    walletClient: options.evm.client,
    address: options.evm.address,
  },
});

const executeBridge = (
  params: Parameters<typeof executeBridgeWithDeps>[0],
  options: BridgeOptions
) =>
  executeBridgeWithDeps(params, toBridgeDeps(options), {
    hooks: options.hooks,
    emit: options.emit,
    fillTimeoutMinutes: options.fillTimeoutMinutes,
  });

const emptyDepositRequest = {
  sources: [],
  destinations: [],
  destinationUniverse: 0,
  destinationChainID: 0n,
  recipientAddress: '0x0000000000000000000000000000000000000000',
  nonce: 0n,
  expiry: 0n,
  parties: [],
};

const emptyRffRequest = {
  sources: [],
  destination_universe: 'EVM',
  destination_chain_id: '0x',
  recipient_address: '0x0000000000000000000000000000000000000000',
  destinations: [],
  nonce: '0',
  expiry: '0',
  parties: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSimulateContract.mockReset();
  mockWatchContractEvent.mockReset();
  mockCreatePublicClientWithFallback.mockReset();
  mockCreatePublicClientWithFallback.mockImplementation(() => ({
    simulateContract: mockSimulateContract,
    watchContractEvent: mockWatchContractEvent,
  }));
  mockWatchContractEvent.mockImplementation(({ onLogs }: { onLogs: (logs: Array<{ transactionHash?: Hex }>) => void }) => {
    const unwatch = vi.fn();
    queueMicrotask(() => {
      onLogs([{ transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex }]);
    });
    return unwatch;
  });
  createRequestFromIntent.mockResolvedValue({
    depositRequest: emptyDepositRequest,
    rffRequest: emptyRffRequest,
    signature: '0x',
    requestHash: '0x',
  });
  findInsufficientAllowanceSources.mockReturnValue([]);
  getAllowances.mockResolvedValue({});
});

describe('bridge pipeline characterization', () => {
  it('emits status, plan preview/confirmed, and bridge progress events on the typed bridge stream', async () => {
    const chainList = createChainList(testDeployment);
    chainList.getVaultContractAddress = () => FAKE_VAULT_ADDRESS;
    const dstChain = chainList.chains[0];
    const { token: dstToken } = chainList.getChainAndTokenFromSymbol(dstChain.id, 'USDC');
    if (!dstToken) {
      throw new Error('Test setup failed: USDC token not found');
    }

    const intent = makeIntent({
      chainId: dstChain.id,
      token: dstToken,
      recipientAddress: '0x0000000000000000000000000000000000000001',
    });

    buildBridgeIntent.mockResolvedValueOnce(intent);

    const options = makeOptions(chainList);
    const events: unknown[] = [];
    options.emit = (event) => {
      events.push(event);
    };
    options.hooks.onIntent = ({ allow }) => allow();

    await executeBridge(
      {
        recipient: options.evm.address,
        dstChain,
        dstToken,
        tokenAmount: 1n,
        nativeAmount: 0n,
        sourceChains: [],
      },
      options
    );

    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'intent_building' },
        { type: 'status', status: 'intent_ready' },
        {
          type: 'plan_preview',
          plan: expect.objectContaining({
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'request_signing' }),
              expect.objectContaining({ type: 'request_submission' }),
              expect.objectContaining({ type: 'bridge_fill' }),
            ]),
          }),
        },
        { type: 'status', status: 'awaiting_approval' },
        { type: 'status', status: 'approved' },
        {
          type: 'plan_confirmed',
          plan: expect.objectContaining({
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'request_signing' }),
              expect.objectContaining({ type: 'request_submission' }),
              expect.objectContaining({ type: 'bridge_fill' }),
            ]),
          }),
        },
        { type: 'status', status: 'executing' },
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'request_signing',
          state: 'completed',
          step: expect.objectContaining({ type: 'request_signing' }),
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'request_submission',
          state: 'completed',
          step: expect.objectContaining({ type: 'request_submission' }),
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'bridge_fill',
          state: 'completed',
          step: expect.objectContaining({ type: 'bridge_fill' }),
        }),
        { type: 'status', status: 'completed' },
      ])
    );
  });

  it('refreshes intent and uses updated intent for processing', async () => {
    const chainList = createChainList(testDeployment);
    chainList.getVaultContractAddress = () => FAKE_VAULT_ADDRESS;
    const dstChain = chainList.chains[0];
    const { token: dstToken } = chainList.getChainAndTokenFromSymbol(dstChain.id, 'USDC');
    if (!dstToken) {
      throw new Error('Test setup failed: USDC token not found');
    }

    const intentA = makeIntent({
      chainId: dstChain.id,
      token: dstToken,
      recipientAddress: '0x0000000000000000000000000000000000000001',
    });
    const intentB = makeIntent({
      chainId: dstChain.id,
      token: dstToken,
      recipientAddress: '0x0000000000000000000000000000000000000002',
    });

    buildBridgeIntent.mockResolvedValueOnce(intentA).mockResolvedValueOnce(intentB);

    const options = makeOptions(chainList);
    options.hooks.onIntent = ({ refresh, allow }) => {
      refresh([123]).then(() => allow());
    };

    await executeBridge(
      {
        recipient: options.evm.address,
        dstChain,
        dstToken,
        tokenAmount: 1n,
        nativeAmount: 0n,
        sourceChains: [],
      },
      options
    );

    expect(buildBridgeIntent).toHaveBeenCalledTimes(2);
    expect(buildBridgeIntent.mock.calls[1]?.[0]?.sourceChains).toEqual([123]);
    // executeBridgeFromIntent passes a narrowed RFF signer config rather than the full bridge options
    const rffCallArgs = createRequestFromIntent.mock.calls[0];
    expect(rffCallArgs[0]).toBe(intentB);
    expect(rffCallArgs[1].evm.address).toBe(options.evm.address);
  });

  it('rejects when intent is denied', async () => {
    const chainList = createChainList(testDeployment);
    chainList.getVaultContractAddress = () => FAKE_VAULT_ADDRESS;
    const dstChain = chainList.chains[0];
    const { token: dstToken } = chainList.getChainAndTokenFromSymbol(dstChain.id, 'USDC');
    if (!dstToken) {
      throw new Error('Test setup failed: USDC token not found');
    }

    const intentA = makeIntent({
      chainId: dstChain.id,
      token: dstToken,
      recipientAddress: '0x0000000000000000000000000000000000000001',
    });
    buildBridgeIntent.mockResolvedValueOnce(intentA);

    const options = makeOptions(chainList);
    options.hooks.onIntent = ({ deny }) => {
      deny();
    };

    await expect(
      executeBridge(
        {
          recipient: options.evm.address,
          dstChain,
          dstToken,
          tokenAmount: 1n,
          nativeAmount: 0n,
          sourceChains: [],
        },
        options
      )
    ).rejects.toMatchObject({
      code: 'user_action/intent_hook_denied',
    });
    expect(createRequestFromIntent).not.toHaveBeenCalled();
  });

  it('emits bridge_fill failed and never emits completed when fill waiting fails', async () => {
    const chainList = createChainList(testDeployment);
    chainList.getVaultContractAddress = () => FAKE_VAULT_ADDRESS;
    const dstChain = chainList.chains[0];
    const { token: dstToken } = chainList.getChainAndTokenFromSymbol(dstChain.id, 'USDC');
    if (!dstToken) {
      throw new Error('Test setup failed: USDC token not found');
    }

    const intent = makeIntent({
      chainId: dstChain.id,
      token: dstToken,
      recipientAddress: '0x0000000000000000000000000000000000000001',
    });

    buildBridgeIntent.mockResolvedValueOnce(intent);
    requestTimeout.mockImplementationOnce(() => new Promise(() => {}));
    waitForIntentFulfilmentFromMiddleware.mockRejectedValueOnce(new Error('fill failed'));

    const options = makeOptions(chainList);
    const events: unknown[] = [];
    options.emit = (event) => {
      events.push(event);
    };
    options.hooks.onIntent = ({ allow }) => allow();

    await expect(
      executeBridge(
        {
          recipient: options.evm.address,
          dstChain,
          dstToken,
          tokenAmount: 1n,
          nativeAmount: 0n,
          sourceChains: [],
        },
        options
      )
    ).rejects.toMatchObject({
      name: 'BackendError',
      code: 'backend/fulfilment_wait_timeout',
      context: { stepType: 'bridge_fill' },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'plan_progress',
        stepType: 'bridge_fill',
        state: 'failed',
      })
    );
    expect(events).not.toContainEqual({ type: 'status', status: 'completed' });
  });

  it('does not fail bridge execution when vault deposit progress uses a padded token address', async () => {
    const chainList = createChainList(testDeployment);
    chainList.getVaultContractAddress = () => FAKE_VAULT_ADDRESS;
    const dstChain = chainList.chains[0];
    const { token: dstToken } = chainList.getChainAndTokenFromSymbol(dstChain.id, 'USDC');
    const sourceChain = chainList.chains.find((chain) => chain.id !== dstChain.id);
    if (!dstToken || !sourceChain) {
      throw new Error('Test setup failed: destination or source chain not found');
    }
    const { token: sourceToken } = chainList.getChainAndTokenFromSymbol(sourceChain.id, 'USDC');
    if (!sourceToken) {
      throw new Error('Test setup failed: source USDC token not found');
    }

    const intent = makeIntent({
      chainId: dstChain.id,
      token: dstToken,
      recipientAddress: '0x0000000000000000000000000000000000000001',
      sources: [
        {
          amount: new Decimal(1),
          amountRaw: 1_000_000n,
          chain: makeChainDisplay(sourceChain.id),
          token: sourceToken,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000001',
          value: new Decimal(1),
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
      ],
    });

    buildBridgeIntent.mockResolvedValueOnce(intent);

    const paddedSourceToken = (`0x${'0'.repeat(24)}${sourceToken.contractAddress.slice(2)}`) as Hex;
    createRequestFromIntent.mockResolvedValueOnce({
      depositRequest: {
        ...emptyDepositRequest,
        sources: [
          {
            chainID: BigInt(sourceChain.id),
            contractAddress: paddedSourceToken,
            fee: 0n,
            universe: Universe.ETHEREUM,
            value: 1_000_000n,
          },
        ],
      },
      rffRequest: {
        ...emptyRffRequest,
        sources: [
          {
            chain_id: '0x1',
            contract_address: paddedSourceToken,
            fee: '0',
            universe: 'EVM',
            value: '1000000',
          },
        ],
      },
      signature: '0x',
      requestHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    });

    const options = makeOptions(chainList);
    const events: unknown[] = [];
    options.emit = (event) => {
      events.push(event);
    };
    options.hooks.onIntent = ({ allow }) => allow();

    await expect(
      executeBridge(
        {
          recipient: options.evm.address,
          dstChain,
          dstToken,
          tokenAmount: 1n,
          nativeAmount: 0n,
          sourceChains: [sourceChain.id],
        },
        options
      )
    ).resolves.toMatchObject({
      intentExplorerUrl: expect.any(String),
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'plan_progress',
        stepType: 'vault_deposit',
        state: 'completed',
        step: expect.objectContaining({
          id: expect.stringContaining(sourceToken.contractAddress.toLowerCase()),
        }),
      })
    );
    expect(events).toContainEqual({ type: 'status', status: 'completed' });
  });
});

describe('bridge allowance hook characterization', () => {
  const makeAllowanceSource = () => ({
    allowance: {
      current: '0',
      currentRaw: 0n,
      minimum: '1',
      minimumRaw: 1n,
    },
    chain: {
      id: 1,
      logo: 'logo',
      name: 'Chain',
    },
    token: {
      contractAddress: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      logo: 'logo',
      name: 'Token',
      symbol: 'TKN',
    },
  });

  it('rejects when allowance inputs length mismatches sources', async () => {
    const chainList = createChainList(testDeployment);
    chainList.getVaultContractAddress = () => FAKE_VAULT_ADDRESS;
    const dstChain = chainList.chains[0];
    const { token: dstToken } = chainList.getChainAndTokenFromSymbol(dstChain.id, 'USDC');
    if (!dstToken) {
      throw new Error('Test setup failed: USDC token not found');
    }

    const intentA = makeIntent({
      chainId: dstChain.id,
      token: dstToken,
      recipientAddress: '0x0000000000000000000000000000000000000001',
    });
    buildBridgeIntent.mockResolvedValueOnce(intentA);
    findInsufficientAllowanceSources.mockReturnValue([makeAllowanceSource()]);

    const options = makeOptions(chainList);
    options.hooks.onIntent = ({ allow }) => allow();
    options.hooks.onAllowance = ({ allow }) => allow([]);

    await expect(
      executeBridge(
        {
          recipient: options.evm.address,
          dstChain,
          dstToken,
          tokenAmount: 1n,
          nativeAmount: 0n,
          sourceChains: [],
        },
        options
      )
    ).rejects.toMatchObject({
      code: 'validation/invalid_allowance_hook',
    });
  });

  it('rejects when allowance hook is denied', async () => {
    const chainList = createChainList(testDeployment);
    chainList.getVaultContractAddress = () => FAKE_VAULT_ADDRESS;
    const dstChain = chainList.chains[0];
    const { token: dstToken } = chainList.getChainAndTokenFromSymbol(dstChain.id, 'USDC');
    if (!dstToken) {
      throw new Error('Test setup failed: USDC token not found');
    }

    const intentA = makeIntent({
      chainId: dstChain.id,
      token: dstToken,
      recipientAddress: '0x0000000000000000000000000000000000000001',
    });
    buildBridgeIntent.mockResolvedValueOnce(intentA);
    findInsufficientAllowanceSources.mockReturnValue([makeAllowanceSource()]);

    const options = makeOptions(chainList);
    options.hooks.onIntent = ({ allow }) => allow();
    options.hooks.onAllowance = ({ deny }) => deny();

    await expect(
      executeBridge(
        {
          recipient: options.evm.address,
          dstChain,
          dstToken,
          tokenAmount: 1n,
          nativeAmount: 0n,
          sourceChains: [],
        },
        options
      )
    ).rejects.toMatchObject({
      code: 'user_action/allowance_approval_denied',
    });
  });
});
