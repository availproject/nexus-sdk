import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSignature, type Hex, type PublicClient, type WalletClient } from 'viem';
import { PermitVariant } from '../../../src/domain/permits';

vi.mock('../../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn().mockResolvedValue(
    (`0x${'aa'.repeat(65)}`) as Hex
  ),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    parseSignature: vi.fn().mockReturnValue({
      r: `0x${'11'.repeat(32)}` as Hex,
      s: `0x${'22'.repeat(32)}` as Hex,
      v: undefined,
      yParity: undefined,
    }),
  };
});

import { materializePermitAuthorizationCall } from '../../../src/swap/wallet/transfer-authorization';
import { makeChain } from '../../helpers/chains';
import { signPermitForAddressAndValue } from '../../../src/services/allowance-utils';

const TOKEN = '0x0000000000000000000000000000000000000001' as Hex;
const EOA = '0x0000000000000000000000000000000000000002' as Hex;
const EPH = '0x0000000000000000000000000000000000000003' as Hex;
const CHAIN = makeChain(42161, 'Arbitrum');

describe('materializePermitAuthorizationCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when the parsed permit signature does not include a recovery id', async () => {
    await expect(
      materializePermitAuthorizationCall({
        chain: CHAIN,
        authorization: {
          kind: 'permit',
          call: null,
          permit: {
            signature: null,
            permitVariant: PermitVariant.EIP2612Canonical,
            permitContractVersion: 1,
          },
        },
        tokenAddress: TOKEN,
        tokenDecimals: 6,
        amount: 1n,
        eoaAddress: EOA,
        eoaWallet: {} as WalletClient,
        ephemeralAddress: EPH,
        publicClient: {} as PublicClient,
      })
    ).rejects.toThrow('Permit signature missing recovery id');
  });

  it('threads the chain into lazy permit signing', async () => {
    vi.mocked(signPermitForAddressAndValue).mockResolvedValueOnce(
      (`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex
    );
    vi.mocked(parseSignature).mockReturnValueOnce({
      r: `0x${'11'.repeat(32)}` as Hex,
      s: `0x${'22'.repeat(32)}` as Hex,
      v: 27n,
      yParity: 0,
    });

    await materializePermitAuthorizationCall({
      chain: CHAIN,
      authorization: {
        kind: 'permit',
        call: null,
        permit: {
          signature: null,
          permitVariant: PermitVariant.EIP2612Canonical,
          permitContractVersion: 1,
        },
      },
      tokenAddress: TOKEN,
      tokenDecimals: 6,
      amount: 1n,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralAddress: EPH,
      publicClient: {} as PublicClient,
    });

    expect(signPermitForAddressAndValue).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAddress: TOKEN }),
      CHAIN,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ address: EOA }),
      EPH,
      1n
    );
  });
});
