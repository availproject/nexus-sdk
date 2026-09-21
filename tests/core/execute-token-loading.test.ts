import { afterEach, expect, it, vi } from 'vitest';
import { createNexusClient } from '../../src';
import * as executeFlow from '../../src/flows/execute';
import { testChains } from '../fixtures/chains';
import { makeTokenFetcher } from '../helpers/catalog';
import { makeMiddlewareClient } from '../helpers/middleware-client';

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as const;
const simulation = { estimatedTotalCost: 1n, estimatedGasUnits: 1n, feeParams: { type: 'legacy' as const, gasPrice: 1n } };

afterEach(() => vi.restoreAllMocks());

const setup = async () => {
  const chains = structuredClone(testChains);
  const getIntentTokens = vi.fn(makeTokenFetcher(chains));
  const client = createNexusClient({ clientId: 'lazy-execute', analytics: { enabled: false }, internal: {
    middlewareClient: makeMiddlewareClient({
      getIntentChains: async () => chains.map(({ tokens: _tokens, ...chain }) => chain), getIntentTokens,
    }),
  } });
  await client.initialize();
  await client.setEVMProvider({ request: vi.fn(async ({ method }) => method === 'eth_accounts' ? [ACCOUNT] : '0x1'), on: vi.fn(), removeListener: vi.fn() });
  return { client, chains, getIntentTokens };
};

it('fetches only the execute approval symbol and reuses its metadata', async () => {
  const { client, getIntentTokens } = await setup();
  vi.spyOn(executeFlow, 'simulateExecute').mockResolvedValue(simulation);
  try {
    expect(client.chainList.getChainByID(1).custom.knownTokens).toEqual([]);
    await client.simulateExecute({ toChainId: 1, to: ACCOUNT });
    expect(getIntentTokens).not.toHaveBeenCalled();
    const params = { toChainId: 1, to: ACCOUNT, tokenApproval: { toTokenSymbol: 'USDC', amount: 1n, spender: ACCOUNT } } as const;
    await client.simulateExecute(params);
    await client.simulateExecute(params);
    expect(getIntentTokens).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 1, symbol: 'usdc', providers: ['nexus-v2'] }));
    expect(client.chainList.getTokenInfoBySymbol(1, 'USDC')).toMatchObject({ contractAddress: testChains[0].tokens[1].address, decimals: 6 });
  } finally { client.destroy(); }
});

it('never approves a different contract with the same symbol in a composite operation', async () => {
  const { client, chains } = await setup();
  const external = { ...chains[0].tokens[1], address: ACCOUNT, providers: [{ id: 'relay' as const }] };
  chains[0].tokens.push(external);
  const simulate = vi.spyOn(executeFlow, 'simulateExecute').mockResolvedValue(simulation);
  const execute = vi.spyOn(executeFlow, 'execute').mockRejectedValue(new Error('must not execute'));
  try {
    await expect(client.swapAndExecute({
      toChainId: 1, toTokenAddress: external.address, toAmountRaw: 1n,
      execute: { to: ACCOUNT, tokenApproval: { toTokenAddress: external.address, amount: 1n, spender: ACCOUNT } },
    })).rejects.toMatchObject({ code: 'validation/token_not_supported' });
    expect(simulate).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  } finally { client.destroy(); }
});
