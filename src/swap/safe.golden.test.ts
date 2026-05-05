import { concatHex, encodeAbiParameters, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  SAFE_L2_SINGLETON,
  SAFE_PROXY_CREATION_CODE,
  SAFE_PROXY_INIT_CODE_HASH,
  SAFE_SALT_NONCE,
} from './safe.constants';
import {
  buildMultiSendPayload,
  buildSafeInitializer,
  hashEnsureAuthorization,
  hashSafeTx,
  predictSafeAccountAddress,
} from './safetx';

const OWNER = '0x1111111111111111111111111111111111111111';
const EXPECTED_SAFE = '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9';

describe('Safe account primitives', () => {
  it('pins canonical Safe proxy creation data', () => {
    expect(SAFE_PROXY_CREATION_CODE.length).toBe(974);
    expect(SAFE_PROXY_INIT_CODE_HASH).toBe(
      '0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee'
    );
    expect(SAFE_SALT_NONCE).toBe(
      11197599655881020237971107609127442512094659259259914404695382623312824468967n
    );
  });

  it('recomputes SAFE_PROXY_INIT_CODE_HASH from creation code so the two pinned constants cannot drift', () => {
    expect(
      keccak256(
        concatHex([
          SAFE_PROXY_CREATION_CODE,
          encodeAbiParameters([{ type: 'address' }], [SAFE_L2_SINGLETON]),
        ])
      )
    ).toBe(SAFE_PROXY_INIT_CODE_HASH);
  });

  it('builds the canonical single-owner initializer', () => {
    expect(buildSafeInitializer(OWNER)).toBe(
      '0xb63e800d0000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000140000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec99000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000000'
    );
  });

  it('predicts the deterministic Safe proxy address for an owner', () => {
    expect(predictSafeAccountAddress(OWNER)).toBe(EXPECTED_SAFE);
  });

  it('hashes the SDK ensure authorization digest', () => {
    expect(
      hashEnsureAuthorization({
        chainId: 999,
        deadline: 1234567890n,
        owner: OWNER,
        safeAddress: EXPECTED_SAFE,
        saltNonce: SAFE_SALT_NONCE,
      })
    ).toBe('0x86e63a9fe475252158c18fda2b98fb42a2e6199bafc98cc1a3bb0415875672e6');
  });

  it('packs MultiSend tuples and hashes SafeTx data exactly', () => {
    const multiSendData = buildMultiSendPayload([
      {
        data: '0x12345678',
        to: '0x2222222222222222222222222222222222222222',
        value: 0n,
      },
      {
        data: '0xabcdef',
        to: '0x3333333333333333333333333333333333333333',
        value: 5n,
      },
    ]);

    expect(multiSendData).toBe(
      '0x8d80ff0a000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000b1002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041234567800333333333333333333333333333333333333333300000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000003abcdef000000000000000000000000000000'
    );

    expect(
      hashSafeTx({
        chainId: 999,
        fields: {
          baseGas: 0n,
          data: multiSendData,
          gasPrice: 0n,
          gasToken: '0x0000000000000000000000000000000000000000',
          nonce: 7n,
          operation: 1,
          refundReceiver: '0x0000000000000000000000000000000000000000',
          safeTxGas: 0n,
          to: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
          value: 0n,
        },
        safeAddress: EXPECTED_SAFE,
      })
    ).toBe('0xaaaeb5f2229dfe45d0dc9f7b54f348146c7f1cf427e26acc81d00b45737ed5cf');
  });
});
