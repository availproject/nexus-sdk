import { Universe } from '@avail-project/ca-common';
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

describe('createVSCClient calibur account methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts get-calibur-account-address requests and decodes the returned account address', async () => {
    postMock.mockResolvedValue({
      data: {
        address: convertTo32Bytes('0x3333333333333333333333333333333333333333'),
        bootstrapped: false,
        deployer: convertTo32Bytes('0x4444444444444444444444444444444444444444'),
        deployed: false,
        owner: convertTo32Bytes('0x1111111111111111111111111111111111111111'),
        salt: convertTo32Bytes(
          '0x5555555555555555555555555555555555555555555555555555555555555555'
        ),
        universe: Universe.ETHEREUM,
      },
    });

    const client = createVSCClient({
      vscUrl: 'https://vsc.example',
      vscWsUrl: 'wss://vsc.example',
    });

    const result = await client.vscGetCaliburAccountAddress(
      SUPPORTED_CHAINS.HYPEREVM,
      '0x1111111111111111111111111111111111111111'
    );

    expect(postMock).toHaveBeenCalledWith('/get-calibur-account-address', {
      chain_id: convertTo32Bytes(SUPPORTED_CHAINS.HYPEREVM),
      owner: convertTo32Bytes('0x1111111111111111111111111111111111111111'),
      universe: Universe.ETHEREUM,
    });
    expect(result.address).toBe('0x3333333333333333333333333333333333333333');
  });

  it('posts ensure-calibur-account requests with managed keys and decodes tx hashes', async () => {
    postMock.mockResolvedValue({
      data: {
        address: convertTo32Bytes('0x3333333333333333333333333333333333333333'),
        bootstrap_tx_hash: convertTo32Bytes(
          '0x7777777777777777777777777777777777777777777777777777777777777777'
        ),
        bootstrapped: true,
        deploy_tx_hash: convertTo32Bytes(
          '0x6666666666666666666666666666666666666666666666666666666666666666'
        ),
        deployed: true,
        deployer: convertTo32Bytes('0x4444444444444444444444444444444444444444'),
        owner: convertTo32Bytes('0x1111111111111111111111111111111111111111'),
        salt: convertTo32Bytes(
          '0x5555555555555555555555555555555555555555555555555555555555555555'
        ),
        universe: Universe.ETHEREUM,
      },
    });

    const client = createVSCClient({
      vscUrl: 'https://vsc.example',
      vscWsUrl: 'wss://vsc.example',
    });

    const result = await client.vscEnsureCaliburAccount({
      chainId: SUPPORTED_CHAINS.HYPEREVM,
      entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      keys: [
        {
          keyType: 2,
          publicKey: convertTo32Bytes('0x2222222222222222222222222222222222222222'),
          settings: convertTo32Bytes(0n),
        },
      ],
      owner: '0x1111111111111111111111111111111111111111',
    });

    expect(postMock).toHaveBeenCalledWith('/ensure-calibur-account', {
      chain_id: convertTo32Bytes(SUPPORTED_CHAINS.HYPEREVM),
      entry_point: convertTo32Bytes('0x0000000071727De22E5E9d8BAf0edAc6f37da032'),
      keys: [
        {
          key_type: 2,
          public_key: convertTo32Bytes('0x2222222222222222222222222222222222222222'),
          settings: convertTo32Bytes(0n),
        },
      ],
      owner: convertTo32Bytes('0x1111111111111111111111111111111111111111'),
      universe: Universe.ETHEREUM,
    });
    expect(result.deployTxHash).toBe(
      '0x6666666666666666666666666666666666666666666666666666666666666666'
    );
    expect(result.bootstrapTxHash).toBe(
      '0x7777777777777777777777777777777777777777777777777777777777777777'
    );
  });

  it('posts direct calibur execute requests and maps the tx hash back to the chain id tuple', async () => {
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

    const result = await client.vscCreateCaliburExecuteTx({
      address: convertTo32Bytes('0x3333333333333333333333333333333333333333'),
      calls: [],
      chain_id: convertTo32Bytes(SUPPORTED_CHAINS.HYPEREVM),
      deadline: convertTo32Bytes(10n),
      key_hash: convertTo32Bytes(0n),
      nonce: convertTo32Bytes(11n),
      revert_on_failure: true,
      signature: new Uint8Array([1, 2, 3]),
      universe: Universe.ETHEREUM,
    });

    expect(postMock).toHaveBeenCalledWith('/create-calibur-execute-tx', {
      address: convertTo32Bytes('0x3333333333333333333333333333333333333333'),
      calls: [],
      chain_id: convertTo32Bytes(SUPPORTED_CHAINS.HYPEREVM),
      deadline: convertTo32Bytes(10n),
      key_hash: convertTo32Bytes(0n),
      nonce: convertTo32Bytes(11n),
      revert_on_failure: true,
      signature: new Uint8Array([1, 2, 3]),
      universe: Universe.ETHEREUM,
    });
    expect(result).toEqual([
      BigInt(SUPPORTED_CHAINS.HYPEREVM),
      '0x8888888888888888888888888888888888888888888888888888888888888888',
    ]);
  });
});
