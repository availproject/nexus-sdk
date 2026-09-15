import {
  decodeFunctionData,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  toHex,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { describe, expect, it, vi } from 'vitest';
import type { Chain } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { createIntentWallet } from '../../src/intent/wallet';
import type { IntentRequiredSignature } from '../../src/intent/types';
import { ERROR_CODES } from '../../src/domain/errors';
import { approvalSignatureRequest, intentSignatureRequest, INTENT_SIGNATURE } from '../fixtures/better-intent';

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as Hex;
const TOKEN = '0x00000000000000000000000000000000000000bb' as Hex;
const SPENDER = '0x00000000000000000000000000000000000000cc' as Hex;
const TX_HASH = `0x${'33'.repeat(32)}` as Hex;

const chain = (id: number): Chain => ({
  id,
  name: `Chain ${id}`,
  universe: Universe.ETHEREUM,
  multicallAddress: ACCOUNT,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logo: '' },
  custom: { icon: '', knownTokens: [] },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.example' } },
  rpcUrls: { default: { http: [`https://rpc-${id}.example`], webSocket: [] } },
});

describe('Better Intent wallet execution', () => {
  it('encodes a caller-selected ERC-20 approval amount and confirms it separately', async () => {
    const sendTransaction = vi.fn().mockResolvedValue(TX_HASH);
    const confirm = vi.fn().mockResolvedValue(undefined);
    const wallet = createIntentWallet({
      address: ACCOUNT,
      provider: { request: vi.fn() },
      walletClient: {
        getChainId: vi.fn().mockResolvedValue(1),
        switchChain: vi.fn(),
        addChain: vi.fn(),
        sendTransaction,
      },
      chainList: { getChainByID: (id: number) => chain(id) },
      confirm,
    });

    const result = await wallet.approve(
      {
        chainId: 1,
        tokenAddress: TOKEN,
        spender: SPENDER,
        owner: ACCOUNT,
        currentRaw: 0n,
        requiredRaw: 10n,
        deficitRaw: 10n,
        approval: { type: 'erc20_approve', to: TOKEN, data: '0x1234', value: '0' },
      },
      20n
    );

    const transaction = sendTransaction.mock.calls[0]?.[0];
    expect(decodeFunctionData({ abi: erc20Abi, data: transaction.data })).toMatchObject({
      functionName: 'approve',
      args: [SPENDER, 20n],
    });
    expect(result).toMatchObject({
      chainId: 1,
      txHash: TX_HASH,
      txExplorerUrl: `https://explorer.example/tx/${TX_HASH}`,
    });
    expect(confirm).not.toHaveBeenCalled();
    await wallet.confirmTransaction(result);
    expect(confirm).toHaveBeenCalledWith(chain(1), TX_HASH);
  });

  it('uses personal_sign with the middleware-provided message', async () => {
    const request = vi.fn().mockResolvedValue(INTENT_SIGNATURE);
    const wallet = createIntentWallet({
      address: ACCOUNT,
      provider: { request },
      walletClient: {},
      chainList: { getChainByID: (id: number) => chain(id) },
      confirm: vi.fn(),
    });

    const instruction = intentSignatureRequest();
    instruction.data.message = '0x1122';
    await expect(wallet.sign(instruction)).resolves.toBe(INTENT_SIGNATURE);
    expect(request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: ['0x1122', ACCOUNT],
    });
  });

  it('switches to the permit chain and signs typed data without losing integer precision', async () => {
    const calls: string[] = [];
    const signTypedData = vi.fn(async (_input: { message: Record<string, string> }) => { calls.push('sign'); return INTENT_SIGNATURE; });
    const request = vi.fn();
    const wallet = createIntentWallet({
      address: ACCOUNT, provider: { request },
      walletClient: {
        getChainId: async () => 1,
        switchChain: async () => { calls.push('switch'); },
        signTypedData,
      },
      chainList: { getChainByID: chain },
    });
    const instruction = approvalSignatureRequest();
    await expect(wallet.sign(instruction)).resolves.toBe(INTENT_SIGNATURE);
    expect(calls).toEqual(['switch', 'sign']);
    expect(signTypedData).toHaveBeenCalledWith({ account: ACCOUNT, ...instruction.data });
    expect(signTypedData.mock.calls[0]?.[0].message.nonce).toBe('9007199254740993');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a permit for another wallet before prompting', async () => {
    const signTypedData = vi.fn();
    const request = vi.fn();
    const wallet = createIntentWallet({
      address: ACCOUNT, provider: { request }, walletClient: { signTypedData },
      chainList: { getChainByID: chain },
    });
    const instruction = approvalSignatureRequest();
    instruction.data.message.owner = SPENDER;
    await expect(wallet.sign(instruction)).rejects.toThrow(/connected account/);
    expect(signTypedData).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['Permit', 'MetaTransaction'] as const)('sends %s through viem as valid EIP-712 JSON', async (primaryType) => {
    const instruction: Extract<IntentRequiredSignature, { kind: 'sourceApproval' }> = approvalSignatureRequest();
    if (primaryType === 'MetaTransaction') {
      instruction.data = {
        domain: { name: 'USD Coin', version: '1', verifyingContract: TOKEN, salt: toHex(8453, { size: 32 }) },
        primaryType,
        types: { MetaTransaction: [
          { name: 'nonce', type: 'uint256' }, { name: 'from', type: 'address' },
          { name: 'functionSignature', type: 'bytes' },
        ] },
        message: { from: ACCOUNT, nonce: '9007199254740993', functionSignature: encodeFunctionData({
          abi: erc20Abi, functionName: 'approve', args: [SPENDER, 10n],
        }) },
      };
    }
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_chainId') return '0x2105';
      expect(method).toBe('eth_signTypedData_v4');
      const [owner, json] = params as [string, string];
      expect(owner.toLowerCase()).toBe(ACCOUNT);
      const data = JSON.parse(json);
      expect(data.primaryType).toBe(primaryType);
      expect(data.message.nonce).toBe('9007199254740993');
      expect(data.types.EIP712Domain).toBeDefined();
      if (primaryType === 'MetaTransaction') expect(data.domain.salt).toBe(toHex(8453, { size: 32 }));
      return INTENT_SIGNATURE;
    });
    const provider = { request };
    const client = createWalletClient({ transport: custom(provider) });
    const wallet = createIntentWallet({
      address: ACCOUNT, provider, walletClient: {
        getChainId: client.getChainId, switchChain: client.switchChain, signTypedData: client.signTypedData,
      },
      chainList: { getChainByID: chain },
    });
    await expect(wallet.sign(instruction)).resolves.toBe(INTENT_SIGNATURE);
  });

  it('reports a denied permit as an allowance rejection', async () => {
    const wallet = createIntentWallet({
      address: ACCOUNT, provider: { request: vi.fn() },
      walletClient: { getChainId: async () => 8453, switchChain: vi.fn(),
        signTypedData: vi.fn().mockRejectedValue({ code: 4001, message: 'Rejected' }),
      },
      chainList: { getChainByID: chain },
    });
    await expect(wallet.sign(approvalSignatureRequest())).rejects.toMatchObject({
      code: ERROR_CODES.USER_ALLOWANCE_APPROVAL_DENIED,
    });
  });

  it.each(['0x1234', '0xinvalid', undefined])('rejects a malformed wallet signature: %s', async (signature) => {
    const wallet = createIntentWallet({
      address: ACCOUNT, provider: { request: vi.fn().mockResolvedValue(signature) },
      walletClient: {}, chainList: { getChainByID: chain },
    });
    await expect(wallet.sign(intentSignatureRequest())).rejects.toThrow(/invalid signature/);
  });

  it('reports native commitment after submission and before receipt confirmation', async () => {
    const order: string[] = [];
    const wallet = createIntentWallet({
      address: ACCOUNT,
      provider: { request: vi.fn() },
      walletClient: {
        getChainId: vi.fn().mockResolvedValue(1),
        switchChain: vi.fn(),
        sendTransaction: vi.fn().mockImplementation(async () => {
          order.push('submitted');
          return TX_HASH;
        }),
      },
      chainList: { getChainByID: (id: number) => chain(id) },
      confirm: vi.fn().mockImplementation(async () => {
        order.push('confirmed');
        return undefined;
      }),
    });

    await wallet.sendNative(
      {
        chainId: 1,
        sourceIndex: 0,
        kind: 'native_source_deposit',
        to: SPENDER,
        valueRaw: 2n,
        functionName: 'deposit',
        abi: [
          {
            type: 'function',
            name: 'deposit',
            stateMutability: 'payable',
            inputs: [
              {
                name: 'request',
                type: 'tuple',
                components: [{ name: 'sender', type: 'address' }],
              },
              { name: 'signature', type: 'bytes' },
              { name: 'sourceIndex', type: 'uint256' },
            ],
            outputs: [],
          },
        ],
        vaultRequest: { sender: ACCOUNT },
      },
      '0x1234',
      () => order.push('committed')
    );

    expect(order).toEqual(['submitted', 'committed', 'confirmed']);
  });

  it('rejects approval instructions owned by another account', async () => {
    const wallet = createIntentWallet({
      address: ACCOUNT,
      provider: { request: vi.fn() },
      walletClient: {},
      chainList: { getChainByID: (id: number) => chain(id) },
      confirm: vi.fn<() => Promise<TransactionReceipt | undefined>>(),
    });

    await expect(
      wallet.approve(
        {
          chainId: 1,
          tokenAddress: TOKEN,
          spender: SPENDER,
          owner: '0x00000000000000000000000000000000000000dd',
          currentRaw: 0n,
          requiredRaw: 10n,
          deficitRaw: 10n,
        },
        10n
      )
    ).rejects.toThrow(/does not match connected account/);
  });
});
