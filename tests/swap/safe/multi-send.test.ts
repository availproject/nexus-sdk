import { describe, expect, it } from 'vitest';
import {
  type Hex,
  concatHex,
  decodeFunctionData,
  numberToHex,
} from 'viem';
import {
  buildMultiSendPayload,
  packMultiSendCall,
} from '../../../src/swap/safe/multi-send';
import { multiSendCallOnlyAbi } from '../../../src/swap/safe/abis';

const SAMPLE = {
  to: '0xabcdef0123456789abcdef0123456789abcdef01',
  value: 0n,
  data: '0xdeadbeef' as Hex,
} as const;

describe('packMultiSendCall', () => {
  it('packs as op(1) ‖ to(20) ‖ value(32) ‖ dataLen(32) ‖ data', () => {
    const packed = packMultiSendCall(SAMPLE);
    const expected = concatHex([
      numberToHex(0, { size: 1 }),
      SAMPLE.to,
      numberToHex(0n, { size: 32 }),
      numberToHex(4, { size: 32 }), // 8 hex chars after 0x = 4 bytes
      SAMPLE.data,
    ]);
    expect(packed).toBe(expected);
  });

  it('throws on odd-length hex data', () => {
    expect(() =>
      packMultiSendCall({ to: SAMPLE.to, value: 0n, data: '0xabc' as Hex })
    ).toThrow();
  });

  it('encodes value correctly', () => {
    const packed = packMultiSendCall({
      to: SAMPLE.to,
      value: 1234n,
      data: '0x' as Hex,
    });
    // value is bytes 21..52 (1 op + 20 addr); slice index 2 + (1+20)*2 = 44, length 64
    const valueHex = packed.slice(2 + 42, 2 + 42 + 64);
    expect(BigInt('0x' + valueHex)).toBe(1234n);
  });
});

describe('buildMultiSendPayload', () => {
  it('wraps packed transactions in multiSend(bytes) calldata', () => {
    const calls = [
      { to: SAMPLE.to, value: 0n, data: '0xdeadbeef' as Hex },
      { to: SAMPLE.to, value: 1n, data: '0xcafe' as Hex },
    ];
    const payload = buildMultiSendPayload(calls);

    const { functionName, args } = decodeFunctionData({
      abi: multiSendCallOnlyAbi,
      data: payload,
    });
    expect(functionName).toBe('multiSend');
    const expectedBytes = concatHex(calls.map(packMultiSendCall));
    expect(args[0]).toBe(expectedBytes);
  });

  it('handles a single call', () => {
    const payload = buildMultiSendPayload([
      { to: SAMPLE.to, value: 0n, data: '0x' as Hex },
    ]);
    expect(payload.startsWith('0x')).toBe(true);
    const { functionName } = decodeFunctionData({
      abi: multiSendCallOnlyAbi,
      data: payload,
    });
    expect(functionName).toBe('multiSend');
  });
});
