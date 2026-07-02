import { describe, expect, it, vi } from 'vitest';
import type {
  EthereumProvider,
  BridgeOptions,
  TokenInfo,
} from '../../src/domain';
import { executeAllowances } from '../../src/services/allowances';
import { makeChain, makeChainList } from '../helpers/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';

vi.mock('../../src/services/evm', () => ({
  createPublicClientWithFallback: vi.fn(() => ({})),
  switchChain: vi.fn(() => Promise.resolve()),
  waitForTxReceipt: vi.fn(),
}));

vi.mock('../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn(),
}));

describe('executeAllowances', () => {
  it('emits confirmed progress after receipt resolves', async () => {
    const { waitForTxReceipt } = await import('../../src/services/evm');

    let resolveReceipt: () => void = () => {};
    const receiptPromise = new Promise<[{ status: string }, null]>((resolve) => {
      resolveReceipt = () => resolve([{ status: 'success' }, null]);
    });
    (waitForTxReceipt as ReturnType<typeof vi.fn>).mockReturnValue(receiptPromise);

    const token: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    };
    const chain = makeChain(10, 'Optimism');
    const chainList = makeChainList([chain], token);
    const provider: EthereumProvider = {
      request: async () => null,
      on() {
        return this;
      },
      removeListener() {
        return this;
      },
    };

    const options: BridgeOptions = {
      evm: {
        address: '0x0000000000000000000000000000000000000002',
        client: {
          writeContract: vi.fn().mockResolvedValue('0xhash'),
        } as unknown as BridgeOptions['evm']['client'],
        provider,
      },
      hooks: {
        onAllowance: () => {},
        onIntent: () => {},
      },
      chainList,
      middlewareClient: makeMiddlewareClient(),
      intentExplorerUrl: 'https://example.com',
    };

    const progressUpdates: Array<{ state: string }> = [];
    const onProgress = (update: { state: string }) => {
      progressUpdates.push(update);
    };

    const allowancePromise = executeAllowances({
      sources: [
        {
          chainID: chain.id,
          tokenContract: token.contractAddress,
          amount: 10n,
        },
      ],
      options,
      dstChain: chain,
      onProgress,
    });

    await new Promise((resolve) => setImmediate(resolve));
    const states = progressUpdates.map((u) => u.state);
    expect(states).toContain('wallet_prompted');
    expect(states).toContain('submitted');
    expect(states).not.toContain('confirmed');

    resolveReceipt();
    await allowancePromise;

    const finalStates = progressUpdates.map((u) => u.state);
    expect(finalStates).toContain('confirmed');
  });

  it('falls back only failed sponsored chains from a single middleware call', async () => {
    const { signPermitForAddressAndValue } = await import('../../src/services/allowance-utils');
    const validSignature =
      `0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}` as `0x${string}`;
    const { waitForTxReceipt } = await import('../../src/services/evm');

    (signPermitForAddressAndValue as ReturnType<typeof vi.fn>).mockResolvedValue(validSignature);
    (waitForTxReceipt as ReturnType<typeof vi.fn>).mockResolvedValue([{ status: 'success' }, null]);

    const token: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
      permitVariant: 1,
      permitVersion: 2,
    };
    const chainA = makeChain(10, 'Optimism');
    const chainB = makeChain(137, 'Polygon');
    const chainList = makeChainList([chainA, chainB], token);

    const writeContract = vi.fn().mockResolvedValue('0xhash');
    const createApprovals = vi.fn().mockResolvedValue([
      { chainId: 10, address: '0x0000000000000000000000000000000000000002', errored: false },
      {
        chainId: 137,
        address: '0x0000000000000000000000000000000000000002',
        errored: true,
        message: 'sponsor failed',
      },
    ]);

    const options: BridgeOptions = {
      evm: {
        address: '0x0000000000000000000000000000000000000002',
        client: { writeContract } as unknown as BridgeOptions['evm']['client'],
        provider: {
          request: async () => null,
          on() {
            return this;
          },
          removeListener() {
            return this;
          },
        } as EthereumProvider,
      },
      hooks: { onAllowance: () => {}, onIntent: () => {} },
      chainList,
      middlewareClient: makeMiddlewareClient({ createApprovals }),
      intentExplorerUrl: 'https://example.com',
    };

    await executeAllowances({
      sources: [
        { chainID: chainA.id, tokenContract: token.contractAddress, amount: 10n },
        { chainID: chainB.id, tokenContract: token.contractAddress, amount: 20n },
      ],
      options,
      dstChain: chainA,
    });

    expect(createApprovals).toHaveBeenCalledTimes(1);
    expect(Object.keys(createApprovals.mock.calls[0][0]).sort()).toEqual(['10', '137']);
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract.mock.calls[0][0].chain.id).toBe(137);
  });

  it('falls back all sponsored chains when middleware call throws', async () => {
    const { signPermitForAddressAndValue } = await import('../../src/services/allowance-utils');
    const validSignature =
      `0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}` as `0x${string}`;
    const { waitForTxReceipt } = await import('../../src/services/evm');

    (signPermitForAddressAndValue as ReturnType<typeof vi.fn>).mockResolvedValue(validSignature);
    (waitForTxReceipt as ReturnType<typeof vi.fn>).mockResolvedValue([{ status: 'success' }, null]);

    const token: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
      permitVariant: 1,
      permitVersion: 2,
    };
    const chainA = makeChain(10, 'Optimism');
    const chainB = makeChain(137, 'Polygon');
    const chainList = makeChainList([chainA, chainB], token);

    const writeContract = vi.fn().mockResolvedValue('0xhash');
    const createApprovals = vi.fn().mockRejectedValue(new Error('middleware offline'));

    const options: BridgeOptions = {
      evm: {
        address: '0x0000000000000000000000000000000000000002',
        client: { writeContract } as unknown as BridgeOptions['evm']['client'],
        provider: {
          request: async () => null,
          on() {
            return this;
          },
          removeListener() {
            return this;
          },
        } as EthereumProvider,
      },
      hooks: { onAllowance: () => {}, onIntent: () => {} },
      chainList,
      middlewareClient: makeMiddlewareClient({ createApprovals }),
      intentExplorerUrl: 'https://example.com',
    };

    await executeAllowances({
      sources: [
        { chainID: chainA.id, tokenContract: token.contractAddress, amount: 10n },
        { chainID: chainB.id, tokenContract: token.contractAddress, amount: 20n },
      ],
      options,
      dstChain: chainA,
    });

    expect(createApprovals).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(2);
  });

  it('aggregates multiple sponsored approvals on the same chain into a single request', async () => {
    const { signPermitForAddressAndValue } = await import('../../src/services/allowance-utils');
    const validSignature =
      `0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}` as `0x${string}`;

    (signPermitForAddressAndValue as ReturnType<typeof vi.fn>).mockResolvedValue(validSignature);

    const token: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
      permitVariant: 1,
      permitVersion: 2,
    };
    const chain = makeChain(10, 'Optimism');
    const chainList = makeChainList([chain], token);

    const createApprovals = vi.fn().mockResolvedValue([
      { chainId: 10, address: '0x0000000000000000000000000000000000000002', errored: false },
    ]);

    const options = {
      evm: {
        address: '0x0000000000000000000000000000000000000002',
        client: { writeContract: vi.fn().mockResolvedValue('0xhash') },
        provider: {
          request: async () => null,
          on() {
            return this;
          },
          removeListener() {
            return this;
          },
        },
      },
      hooks: { onAllowance: () => {}, onIntent: () => {} },
      chainList,
      middlewareClient: makeMiddlewareClient({ createApprovals }),
      intentExplorerUrl: 'https://example.com',
    } as unknown as BridgeOptions;

    await executeAllowances({
      sources: [
        { chainID: chain.id, tokenContract: token.contractAddress, amount: 10n },
        { chainID: chain.id, tokenContract: token.contractAddress, amount: 20n },
      ],
      options,
      dstChain: chain,
    });

    const payload = createApprovals.mock.calls[0][0];
    expect(payload[chain.id][0].ops).toHaveLength(2);
  });
});
