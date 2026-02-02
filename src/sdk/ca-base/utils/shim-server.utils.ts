import type { ReadableIntent } from '../../../commons';
import type { Hex } from 'viem';
import type { Quote, ChainName, Token } from '@mayanfinance/swap-sdk';
import type { Universe } from '@avail-project/ca-common';
import type { SerializedShimRFF, SerializedShimRouteData } from './shim-rff.utils';

const shimUrl = 'http://localhost:4000';

export type MayanQuotes = {
  destination: {
    mayanChain: ChainName;
    mayanToken: Token;
  };
  quotes: {
    quote: Quote;
    mayanChain: ChainName;
    mayanToken: Token;
  }[];
};

export const getQuotes = async (intent: ReadableIntent): Promise<MayanQuotes> => {
  const res = await fetch(`${shimUrl}/transaction/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent,
    }),
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  const { data } = await res.json();
  return data;
};

export const recordTx = async (payload: {
  signatureData: {
    address: `0x${string}`;
    signature: `0x${string}`;
    requestHash: `0x${string}`;
    universe: Universe;
  }[];
  quotes: MayanQuotes;
  rff: SerializedShimRFF;
  route: number;
  routesData: SerializedShimRouteData[];
}): Promise<string> => {
  const res = await fetch(`${shimUrl}/transaction/record`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  const { id } = await res.json();
  return id;
};

export const submitTx = async (payload: {
  id: string;
  sourceTxs: {
    chain: {
      id: number;
      name: string;
      logo: string;
    };
    hash: Hex;
    explorerUrl: string;
  }[];
}): Promise<Record<string, unknown>> => {
  const res = await fetch(`${shimUrl}/transaction/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  const { data } = await res.json();
  return data;
};
