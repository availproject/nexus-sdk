import { type Address, concatHex, encodeFunctionData, type Hex, numberToHex } from 'viem';
import { multiSendCallOnlyAbi } from './abis';
import { SAFE_OPERATION_CALL } from './constants';

export type MultiSendCall = {
  to: Address;
  value: bigint;
  data: Hex;
};

// Tightly packed encoding (NOT ABI-padded):
//   1 byte operation (always 0 — MultiSendCallOnly forbids inner DELEGATECALLs)
//   20 bytes to
//   32 bytes value
//   32 bytes dataLength
//   N bytes data
// The Safe outer-op is DELEGATECALL into MultiSendCallOnly so multiSend runs in the Safe's context.
export function packMultiSendCall(call: MultiSendCall): Hex {
  const dataHex = call.data.slice(2);
  if (dataHex.length % 2 !== 0) {
    throw new Error(`MultiSend call data has odd hex length: ${call.data}`);
  }
  return concatHex([
    numberToHex(SAFE_OPERATION_CALL, { size: 1 }),
    call.to,
    numberToHex(call.value, { size: 32 }),
    numberToHex(dataHex.length / 2, { size: 32 }),
    call.data,
  ]);
}

export function buildMultiSendPayload(calls: MultiSendCall[]): Hex {
  return encodeFunctionData({
    abi: multiSendCallOnlyAbi,
    functionName: 'multiSend',
    args: [concatHex(calls.map(packMultiSendCall))],
  });
}
