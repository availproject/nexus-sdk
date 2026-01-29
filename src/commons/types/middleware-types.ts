import { Hex } from 'viem';

export interface V2BalanceResponse {
  [chainId: string]: {
    currencies: {
      balance: string;
      token_address: string;
      value: string;
    }[];
    total_usd: string;
    universe: string; // "EVM" | "TRON"
    errored: boolean;
  };
}

export interface V2ApprovalOperation {
  tokenAddress: Hex;
  variant: 1 | 2;
  value: Hex | null;
  signature: {
    v: number;
    r: Hex;
    s: Hex;
  };
}

export interface V2ApprovalRequest {
  address: Hex;
  ops: V2ApprovalOperation[];
}

export type V2ApprovalsByChain = Record<number, V2ApprovalRequest[]>;

export interface V2ApprovalResponse {
  chainId: number;
  address: Hex;
  errored: boolean;
  txHash?: Hex;
  message?: string;
}

export interface V2MiddlewareRffRequest {
  sources: {
    universe: string;
    chain_id: string;
    contract_address: string;
    value: string;
    fee: string;
  }[];
  destination_universe: string;
  destination_chain_id: string;
  recipient_address: string;
  destinations: {
    contract_address: string;
    value: string;
  }[];
  nonce: string;
  expiry: string;
  parties: {
    universe: string;
    address: string;
  }[];
}

export interface V2MiddlewareRffPayload {
  request: V2MiddlewareRffRequest;
  signature: Hex;
}
