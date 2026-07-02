import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { EADDRESS } from '../../src/swap/constants';
import {
  createAvailableBalances,
  createBridgeAndExecuteIntent,
  createExecuteRequirement,
  createPriceLookup,
  createSwapAndExecuteIntent,
  computeShortfall,
} from '../../src/services/composite-intent';
import { ZERO_ADDRESS } from '../../src/domain';
import type { BridgeIntent, Chain, ChainListType, OraclePriceResponse, TokenInfo } from '../../src/domain';
import type { SwapIntent } from '../../src/swap/types';
import { Universe } from '../../src/domain/chain-abstraction';

const CHAIN_ID = 42161;
const TOKEN_ADDRESS = '0x1111111111111111111111111111111111111111' as Hex;
const NATIVE_ADDRESS = '0x2222222222222222222222222222222222222222' as Hex;

const chain: Chain = {
  id: CHAIN_ID,
  name: 'Arbitrum',
  universe: Universe.ETHEREUM,
  multicallAddress: '0x',
  nativeCurrency: {
    decimals: 18,
    logo: '',
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['https://arb.example'],
      webSocket: ['wss://arb.example'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arbiscan',
      url: 'https://arbiscan.io',
    },
  },
  custom: {
    icon: 'https://arb.example/logo.png',
    knownTokens: [],
  },
};

const token: TokenInfo = {
  contractAddress: TOKEN_ADDRESS,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
};

const nativeToken: TokenInfo = {
  contractAddress: NATIVE_ADDRESS,
  decimals: 18,
  logo: '',
  name: 'Ether',
  symbol: 'ETH',
};

const chainList = {
  getChainByID: () => chain,
  getNativeToken: () => nativeToken,
} as unknown as ChainListType;

const readableBridgeIntent: BridgeIntent = {
  availableSources: [],
  destination: {
    amount: '1',
    amountRaw: 1_000_000n,
    chain: { id: CHAIN_ID, name: chain.name, logo: chain.custom.icon },
    token: {
      decimals: token.decimals,
      symbol: token.symbol,
      logo: token.logo,
      contractAddress: token.contractAddress,
    },
    value: '1.00',
    nativeAmount: '0.000000000000000000',
    nativeAmountRaw: 0n,
    nativeAmountValue: '0.00',
    nativeAmountInToken: '0.000000',
    nativeToken: {
      decimals: nativeToken.decimals,
      symbol: nativeToken.symbol,
      logo: nativeToken.logo,
      contractAddress: nativeToken.contractAddress,
    },
  },
  fees: {
    caGas: '0',
    protocol: '0',
    solver: '0',
    total: '0',
    totalValue: '0.00',
  },
  selectedSources: [],
  sourcesTotal: '0',
  sourcesTotalValue: '0.00',
  provider: 'nexus',
};

const swapIntent: SwapIntent = {
  destination: {
    amount: '1',
    value: '1.00',
    chain: {
      id: CHAIN_ID,
      logo: chain.custom.icon,
      name: chain.name,
    },
    token: {
      contractAddress: token.contractAddress,
      decimals: token.decimals,
      symbol: token.symbol,
    },
    gas: {
      amount: '0.001',
      value: '2.50',
      token: {
        contractAddress: nativeToken.contractAddress,
        decimals: nativeToken.decimals,
        symbol: nativeToken.symbol,
      },
    },
  },
  feesAndBuffer: {
    buffer: '0',
    bridge: null,
  },
  sources: [],
};

const priceLookup = (chainId: number, tokenAddress: Hex) => {
  if (chainId !== CHAIN_ID) {
    return new Decimal(0);
  }

  if (tokenAddress.toLowerCase() === TOKEN_ADDRESS.toLowerCase()) {
    return new Decimal('1.25');
  }

  if (
    tokenAddress.toLowerCase() === NATIVE_ADDRESS.toLowerCase() ||
    tokenAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase() ||
    tokenAddress.toLowerCase() === EADDRESS.toLowerCase()
  ) {
    return new Decimal('2500');
  }

  return new Decimal(0);
};

describe('createPriceLookup', () => {
  it('prefers balance-derived prices and normalizes native token addresses', () => {
    const oraclePrices: OraclePriceResponse = [
      {
        universe: 'EVM',
        chainId: CHAIN_ID,
        priceUsd: new Decimal('2.00'),
        tokenAddress: TOKEN_ADDRESS,
        tokenSymbol: token.symbol,
        tokenDecimals: token.decimals,
        timestamp: 1,
      },
      {
        universe: 'EVM',
        chainId: CHAIN_ID,
        priceUsd: new Decimal('2000'),
        tokenAddress: ZERO_ADDRESS,
        tokenSymbol: nativeToken.symbol,
        tokenDecimals: nativeToken.decimals,
        timestamp: 1,
      },
    ];

    const lookup = createPriceLookup(
      [
        {
          chainId: CHAIN_ID,
          tokenAddress: TOKEN_ADDRESS,
          amount: new Decimal('10'),
          valueUsd: new Decimal('15'),
        },
        {
          chainId: CHAIN_ID,
          tokenAddress: NATIVE_ADDRESS,
          amount: new Decimal('2'),
          valueUsd: new Decimal('5000'),
        },
      ],
      oraclePrices,
      chainList
    );

    expect(lookup(CHAIN_ID, TOKEN_ADDRESS).toFixed(2)).toBe('1.50');
    expect(lookup(CHAIN_ID, ZERO_ADDRESS).toFixed(2)).toBe('2500.00');
    expect(lookup(CHAIN_ID, EADDRESS as Hex).toFixed(2)).toBe('2500.00');
  });

  it('falls back to oracle pricing and returns zero when missing', () => {
    const lookup = createPriceLookup(
      [],
      [
        {
          universe: 'EVM',
          chainId: CHAIN_ID,
          priceUsd: new Decimal('3.25'),
          tokenAddress: TOKEN_ADDRESS,
          tokenSymbol: token.symbol,
          tokenDecimals: token.decimals,
          timestamp: 1,
        },
      ],
      chainList
    );

    expect(lookup(CHAIN_ID, TOKEN_ADDRESS).toFixed(2)).toBe('3.25');
    expect(
      lookup(CHAIN_ID, '0x9999999999999999999999999999999999999999' as Hex).toFixed(2)
    ).toBe('0.00');
  });
});

describe('computeShortfall', () => {
  it('splits native shortfall across the shared balance pool', () => {
    const result = computeShortfall(
      { token: 100n, gas: 20n, nativeValue: 5n },
      { token: 90n, gas: 95n },
      true
    );

    expect(result).toEqual({
      skipFunding: false,
      tokenShortfall: 10n,
      tokenReserve: 0n,
      gasShortfall: 20n,
      gasReserve: 0n,
    });
  });

  it('returns no funding required when erc20 token and gas are already covered', () => {
    const result = computeShortfall(
      { token: 100n, gas: 20n, nativeValue: 5n },
      { token: 120n, gas: 25n },
      false
    );

    expect(result).toEqual({
      skipFunding: true,
      tokenShortfall: 0n,
      tokenReserve: 100n,
      gasShortfall: 0n,
      gasReserve: 25n,
    });
  });

  it('handles erc20 token and gas pools independently', () => {
    const result = computeShortfall(
      { token: 100n, gas: 20n, nativeValue: 5n },
      { token: 75n, gas: 10n },
      false
    );

    expect(result).toEqual({
      skipFunding: false,
      tokenShortfall: 25n,
      tokenReserve: 0n,
      gasShortfall: 15n,
      gasReserve: 0n,
    });
  });

  it('returns a gas reserve when erc20 token funding is needed but destination gas is already covered with surplus', () => {
    const result = computeShortfall(
      { token: 100n, gas: 20n, nativeValue: 5n },
      { token: 80n, gas: 50n },
      false
    );

    expect(result).toEqual({
      skipFunding: false,
      tokenShortfall: 20n,
      tokenReserve: 0n,
      gasShortfall: 0n,
      gasReserve: 25n,
    });
  });

  it('returns a gas reserve when erc20 token funding is needed and destination gas exactly matches the requirement', () => {
    const result = computeShortfall(
      { token: 100n, gas: 20n, nativeValue: 5n },
      { token: 80n, gas: 25n },
      false
    );

    expect(result).toEqual({
      skipFunding: false,
      tokenShortfall: 20n,
      tokenReserve: 0n,
      gasShortfall: 0n,
      gasReserve: 25n,
    });
  });

  it('returns a token reserve equal to required token when erc20 token is already covered but gas funding is needed', () => {
    // No token shortfall (user already has ≥ required.token on dst) but gas needs to be
    // bridged. The funding swap will still run for gas; tokenReserve flags how much of
    // the dst toToken must NOT be consumed as a swap source — the user keeps it for execute.
    const result = computeShortfall(
      { token: 100n, gas: 20n, nativeValue: 5n },
      { token: 100n, gas: 10n },
      false
    );

    expect(result).toEqual({
      skipFunding: false,
      tokenShortfall: 0n,
      tokenReserve: 100n,
      gasShortfall: 15n,
      gasReserve: 0n,
    });
  });

  it('returns a token reserve equal to required token when erc20 token is held in surplus and gas is short', () => {
    const result = computeShortfall(
      { token: 100n, gas: 20n, nativeValue: 5n },
      { token: 250n, gas: 5n },
      false
    );

    expect(result).toEqual({
      skipFunding: false,
      tokenShortfall: 0n,
      tokenReserve: 100n,
      gasShortfall: 20n,
      gasReserve: 0n,
    });
  });

  it('keeps tokenReserve at 0n when the destination token is native (token / gas share one balance)', () => {
    // Native toToken: tokenReserve is meaningless because token and gas refer to the same
    // on-chain balance. Reservation rides on gasReserve / the toNativeAmountRaw sentinel.
    const result = computeShortfall(
      { token: 100n, gas: 20n, nativeValue: 5n },
      { token: 95n, gas: 95n },
      true
    );

    expect(result.tokenReserve).toBe(0n);
  });
});

describe('execute/composite helpers', () => {
  it('creates execute requirement and available balances with usd values', () => {
    const executeRequirement = createExecuteRequirement({
      chain,
      executeToken: token,
      executeAmountRaw: 2_500_000n,
      to: '0x3333333333333333333333333333333333333333',
      gasEstimate: {
        gasToken: nativeToken,
        amountRaw: 2_000_000_000_000_000n,
        estimatedGasUnits: 21_000n,
        feeParams: { type: 'eip1559' as const, maxFeePerGas: 200_000_000n, maxPriorityFeePerGas: 10_000_000n },
        l1Fee: 30_000_000_000_000n,
        priceTier: 'medium',
      },
      nativeValueRaw: 1_000_000_000_000_000n,
      tokenApproval: {
        token,
        amountRaw: 5_000_000n,
        spender: '0x4444444444444444444444444444444444444444',
      },
      priceLookup,
    });

    const availableBalances = createAvailableBalances({
      chain,
      executeToken: token,
      tokenBalanceRaw: 4_000_000n,
      gasBalanceRaw: 3_000_000_000_000_000n,
      priceLookup,
    });

    expect(executeRequirement.token.amount).toBe('2.5');
    expect(executeRequirement.token.value).toBe('3.13');
    expect(executeRequirement.gas.amount).toBe('0.002');
    expect(executeRequirement.gas.value).toBe('5.00');
    expect(executeRequirement.gas.estimatedGasUnits).toBe('21000');
    expect(executeRequirement.nativeValue).toEqual({
      amount: '0.001',
      amountRaw: 1_000_000_000_000_000n,
      value: '2.50',
    });
    expect(executeRequirement.tokenApproval).toEqual({
      token: {
        address: token.contractAddress,
        symbol: token.symbol,
        decimals: token.decimals,
      },
      amount: '5',
      amountRaw: 5_000_000n,
      spender: '0x4444444444444444444444444444444444444444',
    });
    expect(availableBalances).toEqual({
      token: {
        amount: '4',
        amountRaw: 4_000_000n,
        value: '5.00',
      },
      gas: {
        amount: '0.003',
        amountRaw: 3_000_000_000_000_000n,
        value: '7.50',
      },
    });
  });

  it('creates bridge-and-execute intent variants based on shortfall', () => {
    const executeRequirement = createExecuteRequirement({
      chain,
      executeToken: token,
      executeAmountRaw: 1_000_000n,
      to: '0x3333333333333333333333333333333333333333',
      gasEstimate: {
        gasToken: nativeToken,
        amountRaw: 1_000_000_000_000_000n,
        estimatedGasUnits: 21_000n,
        feeParams: { type: 'eip1559' as const, maxFeePerGas: 200_000_000n, maxPriorityFeePerGas: 10_000_000n },
        l1Fee: 0n,
        priceTier: 'low',
      },
      nativeValueRaw: 0n,
      tokenApproval: null,
      priceLookup,
    });
    const available = createAvailableBalances({
      chain,
      executeToken: token,
      tokenBalanceRaw: 1_000_000n,
      gasBalanceRaw: 1_000_000_000_000_000n,
      priceLookup,
    });

    expect(
      createBridgeAndExecuteIntent({
        executeRequirement,
        available,
        chain,
        executeToken: token,
        priceLookup,
        shortfall: {
          tokenAmountRaw: 0n,
          gasAmountRaw: 0n,
        },
      })
    ).toEqual({
      executeRequirement,
      available,
      bridgeRequired: false,
    });

    expect(
      createBridgeAndExecuteIntent({
        executeRequirement,
        available,
        chain,
        executeToken: token,
        priceLookup,
        shortfall: {
          tokenAmountRaw: 2_000_000n,
          gasAmountRaw: 1_000_000_000_000_000n,
        },
        bridge: readableBridgeIntent,
      })
    ).toEqual({
      executeRequirement,
      available,
      bridgeRequired: true,
      shortfall: {
        token: {
          amount: '2',
          amountRaw: 2_000_000n,
          value: '2.50',
        },
        gas: {
          amount: '0.001',
          amountRaw: 1_000_000_000_000_000n,
          value: '2.50',
        },
      },
      bridge: readableBridgeIntent,
    });
  });

  it('creates swap-and-execute intent variants based on shortfall', () => {
    const executeRequirement = createExecuteRequirement({
      chain,
      executeToken: token,
      executeAmountRaw: 1_000_000n,
      to: '0x3333333333333333333333333333333333333333',
      gasEstimate: {
        gasToken: nativeToken,
        amountRaw: 1_000_000_000_000_000n,
        estimatedGasUnits: 21_000n,
        feeParams: { type: 'eip1559' as const, maxFeePerGas: 200_000_000n, maxPriorityFeePerGas: 10_000_000n },
        l1Fee: 0n,
        priceTier: 'low',
      },
      nativeValueRaw: 0n,
      tokenApproval: null,
      priceLookup,
    });
    const available = createAvailableBalances({
      chain,
      executeToken: token,
      tokenBalanceRaw: 1_000_000n,
      gasBalanceRaw: 1_000_000_000_000_000n,
      priceLookup,
    });

    expect(
      createSwapAndExecuteIntent({
        executeRequirement,
        available,
        chain,
        executeToken: token,
        priceLookup,
        shortfall: {
          tokenAmountRaw: 0n,
          gasAmountRaw: 0n,
        },
      })
    ).toEqual({
      executeRequirement,
      available,
      swapRequired: false,
    });

    expect(
      createSwapAndExecuteIntent({
        executeRequirement,
        available,
        chain,
        executeToken: token,
        priceLookup,
        shortfall: {
          tokenAmountRaw: 2_000_000n,
          gasAmountRaw: 1_000_000_000_000_000n,
        },
        swap: swapIntent,
      })
    ).toEqual({
      executeRequirement,
      available,
      swapRequired: true,
      shortfall: {
        token: {
          amount: '2',
          amountRaw: 2_000_000n,
          value: '2.50',
        },
        gas: {
          amount: '0.001',
          amountRaw: 1_000_000_000_000_000n,
          value: '2.50',
        },
      },
      swap: swapIntent,
    });
  });
});
