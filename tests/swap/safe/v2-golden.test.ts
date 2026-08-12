import { decodeFunctionData, hexToBigInt, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { safeSetupAbi } from '../../../src/swap/safe/abis';
import { SAFE_V2_ON_CHAIN_IDENTIFIER, SAFE_V2_SALT_NONCE } from '../../../src/swap/safe/constants';
import {
  buildSafeDeploymentTransactionV2,
  predictSafeAccountAddressV2,
} from '../../../src/swap/safe/predict';
import { SAFE_V2_GOLDEN } from '../../fixtures/safe-v2-golden';

describe('Safe v2 Protocol Kit 8.0.4 golden vector', () => {
  it('predicts the same two-owner Safe without importing Protocol Kit', () => {
    const result = predictSafeAccountAddressV2(
      SAFE_V2_GOLDEN.eoaAddress,
      SAFE_V2_GOLDEN.ephemeralAddress
    );

    expect(SAFE_V2_SALT_NONCE).toBe(hexToBigInt(SAFE_V2_GOLDEN.saltNonce));
    expect(result).toEqual({
      address: SAFE_V2_GOLDEN.safeAddress,
      factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
      initializer: SAFE_V2_GOLDEN.initializer,
      salt: SAFE_V2_GOLDEN.factorySalt,
    });
  });

  it('keeps the configured owner order and one-of-two threshold in the initializer', () => {
    const decoded = decodeFunctionData({
      abi: safeSetupAbi,
      data: SAFE_V2_GOLDEN.initializer,
    });

    expect(decoded.functionName).toBe('setup');
    expect(decoded.args[0]).toEqual([
      SAFE_V2_GOLDEN.eoaAddress,
      SAFE_V2_GOLDEN.ephemeralAddress,
    ]);
    expect(decoded.args[1]).toBe(1n);
  });

  it('builds attributed canonical deployment calldata', () => {
    const transaction = buildSafeDeploymentTransactionV2(
      SAFE_V2_GOLDEN.eoaAddress,
      SAFE_V2_GOLDEN.ephemeralAddress
    );

    expect(transaction).toEqual({
      to: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
      value: 0n,
      data: SAFE_V2_GOLDEN.deploymentData,
    });
    expect(keccak256(transaction.data)).toBe(SAFE_V2_GOLDEN.deploymentDataHash);
    expect(SAFE_V2_ON_CHAIN_IDENTIFIER).toBe(SAFE_V2_GOLDEN.onChainIdentifier);
  });
});
