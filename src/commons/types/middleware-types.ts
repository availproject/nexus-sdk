import type { Hex } from 'viem';

/**
 * Universe enum for v2 API - matches Rust serialization
 * Note: ABI encoding uses numeric values (0=EVM, 1=TRON), but JSON API uses strings
 */
export type V2Universe = 'EVM' | 'TRON' | 'FUEL' | 'SVM';

/**
 * Source pair for v2 RFF - tokens to bridge from a source chain
 * Matches Solidity: struct SourcePair { Universe universe; uint256 chainID; bytes32 contractAddress; uint256 value; uint256 fee; }
 */
export interface V2SourcePair {
  universe: V2Universe;
  chain_id: string; // U256 as hex string
  contract_address: Hex; // bytes32 (0x-prefixed, 64 chars)
  value: string; // U256 as hex string
  fee: string; // U256 as hex string
}

/**
 * Destination pair for v2 RFF - tokens to receive on destination
 * Matches Solidity: struct DestinationPair { bytes32 contractAddress; uint256 value; }
 */
export interface V2DestinationPair {
  contract_address: Hex; // bytes32
  value: string; // U256 as hex string
}

/**
 * Party involved in the v2 RFF (typically the user)
 * Matches Solidity: struct Party { Universe universe; bytes32 address_; }
 */
export interface V2Party {
  universe: V2Universe;
  address: Hex; // bytes32
}

/**
 * V2 Request for Funds - the core bridge intent
 * Matches Solidity/Rust struct exactly for API compatibility
 */
export interface V2Request {
  sources: V2SourcePair[];
  destination_universe: V2Universe;
  destination_chain_id: string; // U256 as hex string
  recipient_address: Hex; // bytes32
  destinations: V2DestinationPair[];
  nonce: string; // U256 as hex string
  expiry: string; // U256 as hex string
  parties: V2Party[];
}

/**
 * Request body for POST /rff endpoint
 */
export interface CreateRffRequest {
  request: V2Request;
  signature: Hex; // 0x-prefixed hex bytes
}

/**
 * Response from POST /rff endpoint
 */
export interface CreateRffResponse {
  request_hash: Hex; // bytes32
}

/**
 * Response from GET /rff/:hash endpoint
 */
export interface V2RffResponse {
  request: V2Request;
  request_hash: Hex;
  status: 'created' | 'deposited' | 'fulfilled' | 'expired';
  created_at: number;
  updated_at: number;
}

/**
 * Response from GET /rffs endpoint
 */
export interface ListRffsResponse {
  rffs: V2RffResponse[];
}

export interface V2BalanceResponse {
  [chainId: string]: {
    currencies: {
      balance: string;
      token_address: string;
      value: string;
    }[];
    total_usd: string;
    universe: number;
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
