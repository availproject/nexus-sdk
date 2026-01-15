import { EVMRFF, Universe } from '@avail-project/ca-common';
import { ReadableIntent } from '../../../commons';
import { Hex, toHex } from 'viem';
import { Quote, ChainName, Token } from '@mayanfinance/swap-sdk';

const shimUrl = `http://localhost:4000`;

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

export const serializeEVMRFF = (
  rffData: EVMRFF,
  signatureData: {
    address: Uint8Array;
    requestHash: `0x${string}`;
    signature: Uint8Array;
    universe: Universe;
  }[],
  quotes: MayanQuotes,
) => {
  return {
    rff: {
      ...rffData,
      sources: rffData.sources.map((s) => ({
        ...s,
        chainID: s.chainID.toString(),
        value: s.value.toString(),
      })),
      destinationChainID: rffData.destinationChainID.toString(),
      destinations: rffData.destinations.map((d) => ({
        contractAddress: d.contractAddress,
        value: d.value.toString(),
      })),
      nonce: rffData.nonce.toString(),
      expiry: rffData.expiry.toString(),
    },
    signatureData: signatureData.map((x) => ({
      ...x,
      address: toHex(x.address),
      signature: toHex(x.signature),
    })),
    quotes,
  };
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

export const recordTx = async (
  payload: ReturnType<typeof serializeEVMRFF>,
): Promise<string> => {
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
}): Promise<any> => {
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
