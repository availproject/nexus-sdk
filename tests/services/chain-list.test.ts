import { describe, expect, it } from 'vitest';
import { ZERO_ADDRESS } from '../../src/domain';
import { createChainList } from '../../src/services/chain-list';
import { testChains } from '../fixtures/chains';

describe('createChainList from the intent catalog', () => {
  it('preserves execution metadata and Nexus currency IDs from token support', () => {
    const list = createChainList(testChains);
    expect(list.getChainByID(1)).toMatchObject({
      multicallAddress: testChains[0].multicallAddress,
      supports7702: true, swapSupported: true,
      nativeCurrency: { currencyId: 3, decimals: 18 },
    });
    expect(list.getVaultContractAddress(1)).toBe(testChains[0].vaultAddress);
    expect(list.getTokenByCurrencyId(1, 1)).toMatchObject({
      symbol: 'USDC', decimals: 6, permitVariant: 1, permitVersion: 2, mayanEnabled: true,
    });
    expect(list.getTokenByCurrencyId(1, 3)).toMatchObject({ contractAddress: ZERO_ADDRESS, symbol: 'ETH' });
    expect(list.getChainAndTokenByAddress(1, ZERO_ADDRESS).isNativeToken).toBe(true);
    expect(list.getChainAndTokenFromSymbol(1, 'ETH').isNativeToken).toBe(true);
    expect(list.getChainByID(1).custom.knownTokens).toHaveLength(1);
    expect(() => list.getTokenByCurrencyId(1, 999)).toThrow();
    expect(() => list.getTokenByCurrencyId(999, 1)).toThrow();
  });

  it('omits incomplete execute chains without inventing contract addresses', () => {
    const list = createChainList([{ ...testChains[0], multicallAddress: undefined }]);
    expect(list.chains).toEqual([]);
  });

  it('does not coerce external currency IDs or nonnumeric permit versions', () => {
    const chain = structuredClone(testChains[0]);
    chain.tokens[1].providers = [{ id: 'nexus-v2' }, { id: 'relay', currencyId: '1' }];
    chain.tokens[1].permit = { variant: 'emt', version: 'v2' };
    const token = createChainList([chain]).getChainByID(1).custom.knownTokens[0];
    expect(token.currencyId).toBeUndefined();
    expect(token.permitVersion).toBeUndefined();
    expect(token.permitVariant).toBe(4);
  });

  it('preserves execute token identities when external catalogs contain the same symbol', () => {
    const chain = structuredClone(testChains[0]);
    const canonicalAddress = chain.tokens[1].address;
    chain.tokens.unshift({
      ...chain.tokens[1], address: '0x00000000000000000000000000000000000000ab',
      providers: [{ id: 'relay' }],
    });
    const list = createChainList([chain]);
    expect(list.getTokenByAddress(1, canonicalAddress).contractAddress).toBe(canonicalAddress);
    expect(list.getTokenByAddress(1, chain.tokens[0].address).contractAddress).toBe(chain.tokens[0].address);
    expect(list.getChainByID(1).custom.knownTokens).toHaveLength(2);
  });
});
