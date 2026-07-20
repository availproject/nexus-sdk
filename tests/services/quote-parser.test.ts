import { describe, expect, it } from 'vitest';
import { decodeFunctionData, type Hex } from 'viem';
import ERC20ABI, { ERC20PermitABI } from '../../src/abi/erc20';
import { parseQuote } from '../../src/services/quote-parser';
import type { Quote } from '../../src/swap/aggregators/types';
import { EADDRESS } from '../../src/swap/constants';
import { quoteFixture } from '../helpers/quote';

const TOKEN = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const ROUTER = '0x2222222222222222222222222222222222222222' as Hex;
const APPROVAL = '0x1111111111111111111111111111111111111111' as Hex;

const makeQuote = (inputToken = TOKEN): Quote => quoteFixture({
  input: {
    contractAddress: inputToken,
    amount: '3000',
    amountRaw: 3000000000n,
    decimals: 6,
    value: 3000,
    symbol: inputToken === EADDRESS ? 'ETH' : 'USDC',
  },
  output: {
    contractAddress: ROUTER,
    amount: '1.0',
    amountRaw: 1000000000000000000n,
    decimals: 18,
    value: 3000,
    symbol: 'WETH',
  },
  txData: {
    approvalAddress: APPROVAL,
    tx: {
      to: ROUTER,
      data: '0xabcdef' as Hex,
      value: '0x0' as Hex,
    },
  },
});

describe('parseQuote', () => {
  it('extracts approval plus swap calls for ERC20 quotes', () => {
    const parsed = parseQuote(makeQuote());

    expect(parsed.approval).not.toBeNull();
    expect(parsed.swap).toEqual({
      to: ROUTER,
      data: '0xabcdef',
      value: 0n,
    });

    const approval = decodeFunctionData({
      abi: ERC20ABI,
      data: parsed.approval!.data,
    });
    expect(approval.functionName).toBe('approve');
    expect(approval.args).toEqual([APPROVAL, 3000000000n]);
  });

  it('skips approval call for native-input quotes', () => {
    const parsed = parseQuote(makeQuote(EADDRESS as Hex));

    expect(parsed.approval).toBeNull();
    expect(parsed.swap.to).toBe(ROUTER);
  });
});
