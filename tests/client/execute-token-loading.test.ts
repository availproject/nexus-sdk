import { afterEach, expect, it, vi } from 'vitest';
import { createNexusClient, type ExecuteParams } from '../../src';
import * as executeFlow from '../../src/execute/execute';
import { testChains } from '../fixtures/chains';
import { makeTokenFetcher } from '../helpers/catalog';
import { makeMiddlewareClient } from '../helpers/middleware-client';

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as const;
const simulation = { estimatedTotalCost: 1n, estimatedGasUnits: 1n, feeParams: { type: 'legacy' as const, gasPrice: 1n } };
const execution = { chainId: 1, execute: { txHash: '0x1234' as const, txExplorerUrl: '' } };

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

it.each(['execute', 'simulateExecute'] as const)('%s fetches only the approval address and reuses its metadata', async (method) => {
  const { client, getIntentTokens } = await setup();
  vi.spyOn(executeFlow, 'execute').mockResolvedValue(execution);
  vi.spyOn(executeFlow, 'simulateExecute').mockResolvedValue(simulation);
  try {
    expect(client.chainList.getChainByID(1).custom.knownTokens).toEqual([]);
    await client[method]({ toChainId: 1, to: ACCOUNT });
    expect(getIntentTokens).not.toHaveBeenCalled();
    const address = testChains[0].tokens[1].address;
    const params = { toChainId: 1, to: ACCOUNT, tokenApproval: { toTokenAddress: address, amount: 1n, spender: ACCOUNT } } as const;
    await client[method](params);
    await client[method](params);
    expect(getIntentTokens).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 1, contract: address, limit: 1, symbol: undefined, providers: undefined }));
    expect(client.chainList.getTokenByAddress(1, address)).toMatchObject({ contractAddress: address, decimals: 6 });
  } finally { client.destroy(); }
});

it('preserves the selected approval address through a composite operation with duplicate symbols', async () => {
  const { client, chains } = await setup();
  const external = { ...chains[0].tokens[1], address: ACCOUNT, providers: [{ id: 'relay' as const }] };
  chains[0].tokens.push(external);
  const simulate = vi.spyOn(executeFlow, 'simulateExecute').mockResolvedValue(simulation);
  try {
    const tokenApproval = { toTokenAddress: external.address, amount: 1n, spender: ACCOUNT };
    // Stop at quoting; the simulation must already have received the exact approval identity.
    await expect(client.swapAndExecute({
      toChainId: 1, toTokenAddress: external.address, toAmountRaw: 1n,
      execute: { to: ACCOUNT, tokenApproval },
    })).rejects.toThrow('No provider supports the destination');
    expect(simulate).toHaveBeenCalledWith(expect.objectContaining({ tokenApproval }), expect.anything());
    expect(client.chainList.getTokenByAddress(1, external.address).contractAddress).toBe(external.address);
  } finally { client.destroy(); }
});

it.each(['execute', 'simulateExecute'] as const)('%s rejects malformed approval addresses before fetching tokens', async (method) => {
  const { client, getIntentTokens } = await setup();
  try {
    await expect(client[method]({
      toChainId: 1, to: ACCOUNT,
      tokenApproval: { toTokenAddress: '0x1234', amount: 1n, spender: ACCOUNT },
    })).rejects.toMatchObject({ code: 'validation/invalid_input' });
    expect(getIntentTokens).not.toHaveBeenCalled();
  } finally { client.destroy(); }
});

it.each(['execute', 'simulateExecute'] as const)('%s rejects symbol-only approval inputs', async (method) => {
  const { client, getIntentTokens } = await setup();
  vi.spyOn(executeFlow, 'execute').mockResolvedValue(execution);
  vi.spyOn(executeFlow, 'simulateExecute').mockResolvedValue(simulation);
  try {
    const params = { toChainId: 1, to: ACCOUNT, tokenApproval: { toTokenSymbol: 'USDC', amount: 1n, spender: ACCOUNT } };
    await expect(client[method](params as unknown as ExecuteParams)).rejects.toMatchObject({ code: 'validation/invalid_input' });
    expect(getIntentTokens).not.toHaveBeenCalled();
  } finally { client.destroy(); }
});
