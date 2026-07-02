import Decimal from 'decimal.js';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { encodeAbiParameters, recoverMessageAddress, keccak256 } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import type { Universe as NexusUniverse } from '@avail-project/nexus-types';
import type { BridgeIntentDraft, BridgeOptions, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { createRequestFromIntent } from '../../src/services/rff';
import { makeChain, makeChainList } from '../helpers/chains';

const RFF_REQUEST_ABI_PARAMS = [
  {
    name: 'sources',
    type: 'tuple[]',
    components: [
      { name: 'universe', type: 'uint8' },
      { name: 'chainID', type: 'uint256' },
      { name: 'contractAddress', type: 'bytes32' },
      { name: 'value', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
    ],
  },
  { name: 'destinationUniverse', type: 'uint8' },
  { name: 'destinationChainID', type: 'uint256' },
  { name: 'recipientAddress', type: 'bytes32' },
  {
    name: 'destinations',
    type: 'tuple[]',
    components: [
      { name: 'contractAddress', type: 'bytes32' },
      { name: 'value', type: 'uint256' },
    ],
  },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  {
    name: 'parties',
    type: 'tuple[]',
    components: [
      { name: 'universe', type: 'uint8' },
      { name: 'address_', type: 'bytes32' },
    ],
  },
] as const;

const MESSAGE_PREFIX = 'Sign this intent to proceed \n';
const makeChainDisplay = (id: number, name: string) => ({ id, name, logo: `${name}.png` });
const NATIVE_TOKEN: TokenInfo = {
  contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  decimals: 18,
  logo: '',
  name: 'Ether',
  symbol: 'ETH',
};

const universeToNumeric = (universe: NexusUniverse): number => {
  switch (universe) {
    case 'EVM':
      return 0;
    case 'TRON':
      return 1;
    case 'FUEL':
      return 2;
    case 'SVM':
      return 3;
    default:
      return 0;
  }
};

describe('createRequestFromIntent', () => {
  it('returns deposit request/request hash and signs with a random key recoverable to the signer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const token: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    };
    const sourceChain = makeChain(1, 'Ethereum');
    const destinationChain = makeChain(10, 'Optimism');
    const chainList = makeChainList([sourceChain, destinationChain], token);

    const intent: BridgeIntentDraft = {
      availableSources: [],
      recipientAddress: '0x0000000000000000000000000000000000000002',
      fees: {
        caGas: '0',
        deposit: '0',
        fulfillment: '0',
        protocol: '0',
        solver: '0',
      },
      selectedSources: [
        {
          amount: new Decimal('1.5'),
          amountRaw: 1500000n,
          chain: makeChainDisplay(sourceChain.id, sourceChain.name),
          token,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          value: new Decimal(0),
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
      ],
      destination: {
        amount: new Decimal('1.5'),
        amountRaw: 1500000n,
        chain: makeChainDisplay(destinationChain.id, destinationChain.name),
        nativeAmount: new Decimal('0.00000000000000005'),
        nativeAmountRaw: 50n,
        nativeAmountValue: new Decimal(0),
        nativeAmountInToken: new Decimal(0),
        nativeToken: NATIVE_TOKEN,
        token,
        universe: Universe.ETHEREUM,
        value: new Decimal(0),
      },
      provider: 'nexus',
    };

    const account = privateKeyToAccount(generatePrivateKey());

    const { rffRequest, depositRequest, requestHash, signature } = await createRequestFromIntent(intent, {
      evm: {
        address: account.address,
        client: account as unknown as BridgeOptions['evm']['client'],
      },
    });

    const expectedDepositRequest = {
      sources: rffRequest.sources.map((s) => ({
        universe: universeToNumeric(s.universe),
        chainID: BigInt(s.chain_id),
        contractAddress: s.contract_address,
        value: BigInt(s.value),
        fee: BigInt(s.fee),
      })),
      destinations: rffRequest.destinations.map((d) => ({
        contractAddress: d.contract_address,
        value: BigInt(d.value),
      })),
      destinationUniverse: universeToNumeric(rffRequest.destination_universe),
      destinationChainID: BigInt(rffRequest.destination_chain_id),
      recipientAddress: rffRequest.recipient_address,
      nonce: BigInt(rffRequest.nonce),
      expiry: BigInt(rffRequest.expiry),
      parties: rffRequest.parties.map((p) => ({
        universe: universeToNumeric(p.universe),
        address_: p.address,
      })),
    };

    expect(depositRequest).toEqual(expectedDepositRequest);

    const encoded = encodeAbiParameters(RFF_REQUEST_ABI_PARAMS, [
      depositRequest.sources,
      depositRequest.destinationUniverse,
      depositRequest.destinationChainID,
      depositRequest.recipientAddress,
      depositRequest.destinations,
      depositRequest.nonce,
      depositRequest.expiry,
      depositRequest.parties,
    ]);

    const expectedHash = keccak256(encoded);
    const expectedSignatureMessage = `${MESSAGE_PREFIX}${expectedHash}`;

    const recoveredAddress = await recoverMessageAddress({
      message: expectedSignatureMessage,
      signature,
    });

    expect(requestHash).toBe(expectedHash);
    expect(recoveredAddress.toLowerCase()).toBe(account.address.toLowerCase());

    vi.useRealTimers();
  });

  it('throws when a local signer account does not match the configured evm address', async () => {
    const token: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    };
    const sourceChain = makeChain(1, 'Ethereum');
    const destinationChain = makeChain(10, 'Optimism');
    const chainList = makeChainList([sourceChain, destinationChain], token);

    const intent: BridgeIntentDraft = {
      availableSources: [],
      recipientAddress: '0x0000000000000000000000000000000000000002',
      fees: {
        caGas: '0',
        deposit: '0',
        fulfillment: '0',
        protocol: '0',
        solver: '0',
      },
      selectedSources: [
        {
          amount: new Decimal('1.5'),
          amountRaw: 1500000n,
          chain: makeChainDisplay(sourceChain.id, sourceChain.name),
          token,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          value: new Decimal(0),
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
      ],
      destination: {
        amount: new Decimal('1.5'),
        amountRaw: 1500000n,
        chain: makeChainDisplay(destinationChain.id, destinationChain.name),
        nativeAmount: new Decimal('0.00000000000000005'),
        nativeAmountRaw: 50n,
        nativeAmountValue: new Decimal(0),
        nativeAmountInToken: new Decimal(0),
        nativeToken: NATIVE_TOKEN,
        token,
        universe: Universe.ETHEREUM,
        value: new Decimal(0),
      },
      provider: 'nexus',
    };

    const signer = privateKeyToAccount(generatePrivateKey());
    const mismatchedAddress = privateKeyToAccount(generatePrivateKey()).address;

    await expect(
      createRequestFromIntent(intent, {
        evm: {
          address: mismatchedAddress,
          client: signer as unknown as BridgeOptions['evm']['client'],
        },
      })
    ).rejects.toThrow('Signer account does not match configured EVM address');
  });
});
