import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_CHAINS, type VSCClient } from '../commons';
import { resolveDestinationExecution } from './route';

describe('resolveDestinationExecution', () => {
  it('uses the deterministic Calibur account on HyperEVM when a destination swap is required', async () => {
    const vscClient = {
      vscGetCaliburAccountAddress: vi.fn().mockResolvedValue({
        address: '0x3333333333333333333333333333333333333333',
      }),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chainId: SUPPORTED_CHAINS.HYPEREVM,
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationSwap: true,
      vscClient,
    });

    expect(vscClient.vscGetCaliburAccountAddress).toHaveBeenCalledWith(
      SUPPORTED_CHAINS.HYPEREVM,
      '0x1111111111111111111111111111111111111111'
    );
    expect(result).toEqual({
      address: '0x3333333333333333333333333333333333333333',
      entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      mode: 'calibur_account',
    });
  });

  it('keeps the ephemeral executor on 7702 destination paths', async () => {
    const vscClient = {
      vscGetCaliburAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chainId: SUPPORTED_CHAINS.ETHEREUM,
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationSwap: true,
      vscClient,
    });

    expect(vscClient.vscGetCaliburAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x2222222222222222222222222222222222222222',
      entryPoint: null,
      mode: '7702',
    });
  });

  it('keeps direct-to-eoa destination transfers off the smart-account path when no destination swap is needed', async () => {
    const vscClient = {
      vscGetCaliburAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chainId: SUPPORTED_CHAINS.HYPEREVM,
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationSwap: false,
      vscClient,
    });

    expect(vscClient.vscGetCaliburAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x2222222222222222222222222222222222222222',
      entryPoint: null,
      mode: '7702',
    });
  });
});
