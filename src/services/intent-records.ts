import type { Universe as MiddlewareUniverse, RFF } from '@avail-project/nexus-types';
import type { Hex } from 'viem';
import type { ChainListType, IntentRecord } from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { Errors } from '../domain/errors';
import { convertAddressByUniverse } from './addresses';
import { getIntentExplorerUrl } from './explorer';
import { divDecimals } from './math';

const middlewareUniverseToInternal = (universe: MiddlewareUniverse): Universe => {
  switch (universe) {
    case 'EVM':
      return Universe.ETHEREUM;
    case 'FUEL':
      return Universe.FUEL;
    case 'SVM':
      return Universe.SOLANA;
    case 'TRON':
      return Universe.TRON;
    default:
      throw Errors.universeNotSupported();
  }
};

const normalizeAddress = (address: Hex, universe: MiddlewareUniverse): Hex =>
  convertAddressByUniverse(address, middlewareUniverseToInternal(universe)) as Hex;

export const toIntentRecord = (
  intent: RFF,
  chainList: ChainListType,
  intentExplorerUrl: string
): IntentRecord => {
  const destinationChainId = Number(intent.request.destination_chain_id);
  const destinationChain = chainList.getChainByID(destinationChainId);
  const destinationUniverse = intent.request.destination_universe;

  return {
    requestHash: intent.request_hash,
    explorerUrl: getIntentExplorerUrl(intentExplorerUrl, intent.request_hash),
    status: intent.status,
    solver: intent.solver ? normalizeAddress(intent.solver, destinationUniverse) : null,
    createdAt: intent.created_at,
    updatedAt: intent.updated_at,
    expiry: Number(intent.request.expiry),
    recipientAddress: normalizeAddress(intent.request.recipient_address, destinationUniverse),
    destinationChain: {
      id: destinationChain.id,
      name: destinationChain.name,
      logo: destinationChain.custom.icon,
      universe: destinationUniverse,
    },
    sources: intent.request.sources.map((source) => {
      const sourceChainId = Number(source.chain_id);
      const sourceTokenAddress = normalizeAddress(source.contract_address, source.universe);
      const { chain, token } = chainList.getChainAndTokenByAddress(
        sourceChainId,
        sourceTokenAddress
      );
      const amountRaw = BigInt(source.value);
      const feeRaw = BigInt(source.fee);

      return {
        chain: {
          id: chain.id,
          name: chain.name,
          logo: chain.custom.icon,
          universe: source.universe,
        },
        token: {
          contractAddress: token.contractAddress,
          symbol: token.symbol,
          name: token.name,
          logo: token.logo,
          decimals: token.decimals,
        },
        amountRaw,
        amount: divDecimals(amountRaw, token.decimals).toFixed(token.decimals),
        feeRaw,
        fee: divDecimals(feeRaw, token.decimals).toFixed(token.decimals),
      };
    }),
    destinations: intent.request.destinations.map((destination) => {
      const tokenAddress = normalizeAddress(destination.contract_address, destinationUniverse);
      const { token } = chainList.getChainAndTokenByAddress(destinationChainId, tokenAddress);
      const amountRaw = BigInt(destination.value);

      return {
        token: {
          contractAddress: token.contractAddress,
          symbol: token.symbol,
          name: token.name,
          logo: token.logo,
          decimals: token.decimals,
        },
        amountRaw,
        amount: divDecimals(amountRaw, token.decimals).toFixed(token.decimals),
      };
    }),
  };
};
