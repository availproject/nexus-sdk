import { type Hex, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { MAYAN_MIN_USD_PER_LEG, MAYAN_SLIPPAGE_BPS, quoteMayanLegs } from '../../src/services/mayan';
import type { MayanQuote, MayanQuoteRequest } from '../../src/transport';
import { makeMiddlewareClient } from '../helpers/middleware-client';

describe('quoteMayanLegs', () => {
  const USDC_ARB = '0x0000000000000000000000000000000000000a01' as Hex;
  const USDC_OP = '0x0000000000000000000000000000000000000a02' as Hex;
  const USDC_BASE = '0x0000000000000000000000000000000000000b01' as Hex;
  const ARB = 42161;
  const OP = 10;
  const BASE = 8453;

  // Echoes each requested source back in order; minReceived = amount (human, 6dp).
  const echoClient = (capture?: (req: MayanQuoteRequest) => void) =>
    makeMiddlewareClient({
      getMayanQuotes: async (req) => {
        capture?.(req);
        return {
          destination: {
            chainId: Number(BigInt(req.destination.chain_id)),
            tokenAddress: req.destination.contract_address as Hex,
          },
          quotes: req.sources.map((s) => ({
            source: {
              chainId: Number(BigInt(s.chain_id)),
              tokenAddress: s.contract_address as Hex,
              amount: s.amount,
            },
            mayanQuote: { minReceived: Number(s.amount) / 1e6, protocolBps: 0 } as MayanQuote,
          })),
        };
      },
    });

  it('builds the request and returns per-leg quotes in order', async () => {
    let captured: MayanQuoteRequest | undefined;
    const client = echoClient((req) => {
      captured = req;
    });

    const result = await quoteMayanLegs(client, {
      legs: [
        { chainId: ARB, tokenAddress: USDC_ARB, amountRaw: 10_000_000n },
        { chainId: OP, tokenAddress: USDC_OP, amountRaw: 5_000_000n },
      ],
      destination: { chainId: BASE, tokenAddress: USDC_BASE },
    });

    expect(captured?.sources).toEqual([
      { chain_id: toHex(ARB), contract_address: USDC_ARB, amount: '10000000' },
      { chain_id: toHex(OP), contract_address: USDC_OP, amount: '5000000' },
    ]);
    expect(captured?.destination).toEqual({
      chain_id: toHex(BASE),
      contract_address: USDC_BASE,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ chainId: ARB, tokenAddress: USDC_ARB });
    expect(result[0]!.minReceived.toFixed()).toBe('10');
    expect(result[1]!.minReceived.toFixed()).toBe('5');
    expect(result[0]!.quote.minReceived).toBe(10);
  });

  it('includes gas_drop only for legs that set it', async () => {
    let captured: MayanQuoteRequest | undefined;
    const client = echoClient((req) => {
      captured = req;
    });

    await quoteMayanLegs(client, {
      legs: [
        { chainId: ARB, tokenAddress: USDC_ARB, amountRaw: 10_000_000n, gasDrop: 0.01 },
        { chainId: OP, tokenAddress: USDC_OP, amountRaw: 5_000_000n },
      ],
      destination: { chainId: BASE, tokenAddress: USDC_BASE },
    });

    expect(captured?.sources[0]).toHaveProperty('gas_drop', 0.01);
    expect(captured?.sources[1]).not.toHaveProperty('gas_drop');
  });

  it('sends slippage_bps as a top-level field from MAYAN_SLIPPAGE_BPS', async () => {
    let captured: MayanQuoteRequest | undefined;
    const client = echoClient((req) => {
      captured = req;
    });

    await quoteMayanLegs(client, {
      legs: [{ chainId: ARB, tokenAddress: USDC_ARB, amountRaw: 1_000_000n }],
      destination: { chainId: BASE, tokenAddress: USDC_BASE },
    });

    // Sibling of sources/destination — nested under `destination` the schema would strip it.
    expect(captured?.slippage_bps).toBe(MAYAN_SLIPPAGE_BPS);
  });

  it('throws when the response length does not match the legs', async () => {
    const client = makeMiddlewareClient({
      getMayanQuotes: async () => ({
        destination: { chainId: BASE, tokenAddress: USDC_BASE },
        quotes: [],
      }),
    });

    await expect(
      quoteMayanLegs(client, {
        legs: [{ chainId: ARB, tokenAddress: USDC_ARB, amountRaw: 1_000_000n }],
        destination: { chainId: BASE, tokenAddress: USDC_BASE },
      })
    ).rejects.toThrow('length mismatch');
  });

  it('throws when a returned leg does not match the requested source', async () => {
    // Reverses the quote order so the index-aligned source check fails.
    const client = makeMiddlewareClient({
      getMayanQuotes: async (req) => ({
        destination: { chainId: BASE, tokenAddress: USDC_BASE },
        quotes: [...req.sources].reverse().map((s) => ({
          source: {
            chainId: Number(BigInt(s.chain_id)),
            tokenAddress: s.contract_address as Hex,
            amount: s.amount,
          },
          mayanQuote: { minReceived: 1, protocolBps: 0 } as MayanQuote,
        })),
      }),
    });

    await expect(
      quoteMayanLegs(client, {
        legs: [
          { chainId: ARB, tokenAddress: USDC_ARB, amountRaw: 1_000_000n },
          { chainId: OP, tokenAddress: USDC_OP, amountRaw: 2_000_000n },
        ],
        destination: { chainId: BASE, tokenAddress: USDC_BASE },
      })
    ).rejects.toThrow('source mismatch');
  });

  it('pins the per-leg USD floor', () => {
    expect(MAYAN_MIN_USD_PER_LEG).toBe(1.1);
  });

  it('pins the Mayan slippage bps', () => {
    expect(MAYAN_SLIPPAGE_BPS).toBe(5);
  });
});
