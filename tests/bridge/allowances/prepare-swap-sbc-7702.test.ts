import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { prepareSwapBridgeExecution } from '../../../src/bridge/allowances/prepare-swap-sbc';
import type { AllowanceHookSource, BridgeIntentDraft, ChainListType } from '../../../src/domain';
import type { PublicClientList } from '../../../src/swap/types';

vi.mock('../../../src/services/sbc', () => ({
  createSBCTxFromCalls: vi.fn().mockResolvedValue({
    chainId: 42161,
    address: '0x0000000000000000000000000000000000000abc' as Hex,
    calls: [],
    deadline: '0x1' as Hex,
    keyHash: '0x0' as Hex,
    nonce: '0x1' as Hex,
    revertOnFailure: true,
    signature: '0x1234' as Hex,
  }),
  requireSuccessfulSbcResult: vi.fn(() => '0xsbc_tx' as Hex),
}));

import { createSBCTxFromCalls } from '../../../src/services/sbc';

const ARB_CHAIN = 42161;
const HYPEREVM_CHAIN = 999;
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDC_HYPEREVM = '0xb88339cb7199b77e23db6e890353e22632ba630f' as Hex;
const EPHEMERAL = '0xbbbb000000000000000000000000000000000002' as Hex;

const makeChainList = (): ChainListType =>
  ({
    chains: [],
    // ARB = 7702-supported, HyperEVM = non-7702
    getChainByID: vi.fn().mockImplementation((chainId: number) => ({
      id: chainId,
      supports7702: chainId === ARB_CHAIN,
      name: `Chain ${chainId}`,
    })),
    getVaultContractAddress: vi
      .fn()
      .mockReturnValue('0x9999999999999999999999999999999999999999' as Hex),
    getTokenByCurrencyId: vi.fn(),
    getTokenByAddress: vi.fn(),
    getChainAndTokenByAddress: vi.fn(),
    getNativeToken: vi.fn(),
    getTokenInfoBySymbol: vi.fn(),
    getChainAndTokenFromSymbol: vi.fn(),
  }) as unknown as ChainListType;

const makePublicClientList = (): PublicClientList =>
  ({
    get: vi.fn().mockReturnValue({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    }),
  }) as unknown as PublicClientList;

const makeEphemeralWallet = (): PrivateKeyAccount =>
  ({
    address: EPHEMERAL,
    signTypedData: vi.fn(),
  }) as unknown as PrivateKeyAccount;

const makeIntent = (): BridgeIntentDraft =>
  ({
    destination: { chain: { id: ARB_CHAIN } },
  }) as unknown as BridgeIntentDraft;

describe('prepareSwapBridgeExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips ephemeral SBC pre-approvals on non-7702 source chains', async () => {
    const submitSBCs = vi.fn().mockResolvedValue([
      {
        chainId: ARB_CHAIN,
        address: '0x0000000000000000000000000000000000000abc' as Hex,
        errored: false,
        txHash: '0xsbc_tx' as Hex,
      },
    ]);
    const createApprovals = vi.fn();

    const makeSource = (chainId: number, tokenAddress: Hex): AllowanceHookSource => ({
      allowance: {
        current: '0',
        currentRaw: 0n,
        minimum: '1',
        minimumRaw: 1000000n,
      },
      chain: { id: chainId, logo: '', name: `Chain ${chainId}` },
      token: {
        contractAddress: tokenAddress,
        decimals: 6,
        logo: '',
        name: 'USDC',
        symbol: 'USDC',
      },
    });
    const insufficientAllowanceSources: AllowanceHookSource[] = [
      makeSource(ARB_CHAIN, USDC_ARB),
      makeSource(HYPEREVM_CHAIN, USDC_HYPEREVM),
    ];

    await prepareSwapBridgeExecution(makeIntent(), {
      allowanceSelections: ['min', 'min'],
      insufficientAllowanceSources,
      middlewareClient: {
        submitSBCs,
        createApprovals,
      } as never,
      ephemeralWallet: makeEphemeralWallet(),
      chainList: makeChainList(),
      publicClientList: makePublicClientList(),
      cache: undefined,
    });

    expect(submitSBCs).toHaveBeenCalledTimes(1);
    const calledChainIds = vi
      .mocked(createSBCTxFromCalls)
      .mock.calls.map(([input]) => input.chainID);
    expect(calledChainIds).toEqual([ARB_CHAIN]);
    expect(calledChainIds).not.toContain(HYPEREVM_CHAIN);
  });
});
