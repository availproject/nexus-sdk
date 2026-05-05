import { Universe } from '@avail-project/ca-common';
import { toBytes } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_CHAINS } from '../../commons';
import { convertTo32Bytes } from './common.utils';

const postMock = vi.hoisted(() => vi.fn());
const axiosCreateMock = vi.hoisted(() => vi.fn(() => ({ post: postMock })));

vi.mock('axios', () => ({
  default: {
    create: axiosCreateMock,
  },
}));

import { createVSCClient } from './api.utils';

describe('createVSCClient Safe account methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts get-safe-account-address requests and decodes the returned account address', async () => {
    postMock.mockResolvedValue({
      data: {
        address: convertTo32Bytes('0x3333333333333333333333333333333333333333'),
        exists: false,
        factory_address: convertTo32Bytes('0x4444444444444444444444444444444444444444'),
        owner: convertTo32Bytes('0x1111111111111111111111111111111111111111'),
        universe: Universe.ETHEREUM,
      },
    });

    const client = createVSCClient({
      vscUrl: 'https://vsc.example',
      vscWsUrl: 'wss://vsc.example',
    });

    const result = await client.vscGetSafeAccountAddress(
      SUPPORTED_CHAINS.HYPEREVM,
      '0x1111111111111111111111111111111111111111'
    );

    expect(postMock).toHaveBeenCalledWith('/get-safe-account-address', {
      chain_id: convertTo32Bytes(SUPPORTED_CHAINS.HYPEREVM),
      owner: convertTo32Bytes('0x1111111111111111111111111111111111111111'),
      universe: Universe.ETHEREUM,
    });
    expect(result.address).toBe('0x3333333333333333333333333333333333333333');
    expect(result.factoryAddress).toBe('0x4444444444444444444444444444444444444444');
  });

  it('posts ensure-safe-account requests with owner signature and decodes deploy tx hashes', async () => {
    postMock.mockResolvedValue({
      data: {
        address: convertTo32Bytes('0x3333333333333333333333333333333333333333'),
        deploy_tx_hash: convertTo32Bytes(
          '0x6666666666666666666666666666666666666666666666666666666666666666'
        ),
        exists: true,
      },
    });

    const client = createVSCClient({
      vscUrl: 'https://vsc.example',
      vscWsUrl: 'wss://vsc.example',
    });

    const result = await client.vscEnsureSafeAccount({
      chainId: SUPPORTED_CHAINS.HYPEREVM,
      deadline: 123n,
      owner: '0x1111111111111111111111111111111111111111',
      safeAddress: '0x3333333333333333333333333333333333333333',
      saltNonce: 456n,
      signature: '0x999999',
    });

    expect(postMock).toHaveBeenCalledWith('/ensure-safe-account', {
      chain_id: convertTo32Bytes(SUPPORTED_CHAINS.HYPEREVM),
      deadline: convertTo32Bytes(123n),
      owner: convertTo32Bytes('0x1111111111111111111111111111111111111111'),
      safe_address: convertTo32Bytes('0x3333333333333333333333333333333333333333'),
      salt_nonce: convertTo32Bytes(456n),
      signature: new Uint8Array([0x99, 0x99, 0x99]),
      universe: Universe.ETHEREUM,
    });
    expect(result.deployTxHash).toBe(
      '0x6666666666666666666666666666666666666666666666666666666666666666'
    );
    expect(result.exists).toBe(true);
  });

  it('posts Safe execute requests and maps the tx hash back to the chain id tuple', async () => {
    postMock.mockResolvedValue({
      data: {
        tx_hash: convertTo32Bytes(
          '0x8888888888888888888888888888888888888888888888888888888888888888'
        ),
      },
    });

    const client = createVSCClient({
      vscUrl: 'https://vsc.example',
      vscWsUrl: 'wss://vsc.example',
    });

    const result = await client.vscCreateSafeExecuteTx({
      baseGas: 0n,
      chainId: SUPPORTED_CHAINS.HYPEREVM,
      data: '0xabcdef',
      gasPrice: 0n,
      gasToken: '0x0000000000000000000000000000000000000000',
      nonce: 11n,
      operation: 1,
      refundReceiver: '0x0000000000000000000000000000000000000000',
      safeAddress: '0x3333333333333333333333333333333333333333',
      safeTxGas: 0n,
      signature: '0x010203',
      to: '0x4444444444444444444444444444444444444444',
      value: 5n,
    });

    expect(postMock).toHaveBeenCalledWith('/create-safe-execute-tx', {
      base_gas: convertTo32Bytes(0n),
      chain_id: convertTo32Bytes(SUPPORTED_CHAINS.HYPEREVM),
      data: new Uint8Array([0xab, 0xcd, 0xef]),
      gas_price: convertTo32Bytes(0n),
      gas_token: toBytes('0x0000000000000000000000000000000000000000'),
      nonce: convertTo32Bytes(11n),
      operation: 1,
      refund_receiver: toBytes('0x0000000000000000000000000000000000000000'),
      safe_address: convertTo32Bytes('0x3333333333333333333333333333333333333333'),
      safe_tx_gas: convertTo32Bytes(0n),
      signature: new Uint8Array([1, 2, 3]),
      to: toBytes('0x4444444444444444444444444444444444444444'),
      universe: Universe.ETHEREUM,
      value: convertTo32Bytes(5n),
    });
    expect(result).toEqual([
      BigInt(SUPPORTED_CHAINS.HYPEREVM),
      '0x8888888888888888888888888888888888888888888888888888888888888888',
    ]);
  });
});
