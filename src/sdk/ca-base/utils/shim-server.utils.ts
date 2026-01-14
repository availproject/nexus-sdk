import { ReadableIntent } from '../../../commons';

const shimUrl = `http://localhost:4000`;

export const getQuotes = async (intent: ReadableIntent) => {
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
  return data as {
    destination: {
      mayanChain: any;
      mayanToken: any;
    };
    quotes: {
      quote: any;
      mayanChain: any;
      mayanToken: any;
    }[];
  };
};

export const recordTx = async (payload: any) => {
  const res = await fetch(`${shimUrl}/transaction/record`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transaction: payload,
    }),
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  const { data } = await res.json();
  return data as {
    id: string;
    data: unknown;
    status: 'success' | 'recorded' | 'submitted' | 'pending' | 'partial-failure' | 'failure';
    createdAt: Date;
    updatedAt: Date;
  };
};
