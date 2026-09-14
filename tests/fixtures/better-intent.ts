import type { Hex } from 'viem';

export const INTENT_ACCOUNT = '0x00000000000000000000000000000000000000aa' as Hex;
export const INTENT_TOKEN = '0x00000000000000000000000000000000000000bb' as Hex;
export const INTENT_SPENDER = '0x00000000000000000000000000000000000000cc' as Hex;
export const INTENT_ID = `0x${'11'.repeat(32)}` as Hex;
export const INTENT_SIGNATURE = `0x${'22'.repeat(65)}` as Hex;
export const APPROVAL_SIGNATURE = `0x${'33'.repeat(65)}` as Hex;

export const intentSignatureRequest = () => ({
  kind: 'intent' as const,
  universe: 'EVM' as const,
  signingScheme: 'personal_sign' as const,
  data: { messagePrefix: 'Sign this intent to proceed', message: '0x12' as Hex, hash: INTENT_ID },
});

export const approvalSignatureRequest = () => ({
  kind: 'sourceApproval' as const,
  universe: 'EVM' as const,
  chainId: 8453,
  tokenAddress: INTENT_TOKEN,
  signingScheme: 'eip712' as const,
  data: {
    domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: INTENT_TOKEN },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit' as const,
    message: {
      owner: INTENT_ACCOUNT, spender: INTENT_SPENDER, value: '10', nonce: '9007199254740993',
      deadline: '2000000000',
    },
  },
});

export const sponsoredQuoteResponse = () => ({
  quoteId: INTENT_ID, provider: 'nexus-v2', tradeType: 'exactOutput',
  input: [{
    chainId: 'EVM_8453', tokenAddress: INTENT_TOKEN, tokenSymbol: 'USDC',
    amount: '10', amountUsd: '0.00001', depositFee: '0', depositFeeUsd: '0',
    totalRequired: '10', totalRequiredUsd: '0.00001',
  }],
  output: { chainId: 'EVM_1', tokenAddress: INTENT_TOKEN, amount: '9', amountUsd: '0.000009' },
  minAmountOut: '8', minAmountOutUsd: '0.000008',
  fees: {
    deposit: '0', fulfillment: '0', protocol: '0', solver: '0',
    depositUsd: '0', fulfillmentUsd: '0', protocolUsd: '0', solverUsd: '0',
  },
  expiry: '2000000000', rff: { sources: [], destinations: [], parties: [] }, rffHash: INTENT_ID,
  allowances: [{
    universe: 'EVM', chainId: 8453, tokenAddress: INTENT_TOKEN, spender: INTENT_SPENDER,
    owner: INTENT_ACCOUNT, current: '0', required: '10', deficit: '10',
    authorizationType: 'permit',
    approval: { type: 'erc20_approve', to: INTENT_TOKEN, data: '0x1234', value: '0' },
  }],
  nativeTransactions: [],
  submitRequirements: {
    requiredSignatures: [intentSignatureRequest(), approvalSignatureRequest()],
    requiresApprovals: true, requiresNativeTxReceipts: false,
  },
});
