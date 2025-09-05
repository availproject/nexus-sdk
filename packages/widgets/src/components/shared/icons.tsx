import {
  CHAIN_METADATA,
  SUPPORTED_CHAINS,
  TOKEN_METADATA,
  DESTINATION_SWAP_TOKENS,
  type ChainMetadata,
  type TokenMetadata,
} from '@nexus/commons';
import { cn } from '../../utils/utils';

export const ChainIcon = ({ chainId }: { chainId: string }) => {
  const chain = Object.values(CHAIN_METADATA).find(
    (c: ChainMetadata) => c.id.toString() === chainId,
  );
  const iconUrl = chain?.logo;

  if (!iconUrl) {
    return <div className="w-6 h-6 bg-gray-300 rounded-nexus-full" />;
  }

  return (
    <img
      src={iconUrl}
      alt={chainId}
      className={cn(
        '',
        chain?.id !== SUPPORTED_CHAINS.BASE && chain?.id !== SUPPORTED_CHAINS.BASE_SEPOLIA
          ? 'rounded-nexus-full w-6 h-6'
          : 'w-5 h-5',
      )}
    />
  );
};

export const TokenIcon = ({
  tokenSymbol,
  className = 'w-6 h-6 rounded-nexus-full',
}: {
  tokenSymbol: string;
  className?: string;
}) => {
  // First try standard TOKEN_METADATA
  const standardToken = TOKEN_METADATA[tokenSymbol as keyof typeof TOKEN_METADATA] as TokenMetadata;
  let iconUrl: string | undefined = standardToken?.icon;

  // If not found in standard tokens, search destination swap tokens
  if (!iconUrl) {
    const allDestinationTokens = Array.from(DESTINATION_SWAP_TOKENS.values()).flat();
    const destinationToken = allDestinationTokens.find((token) => token.symbol === tokenSymbol);
    iconUrl = destinationToken?.logo;
  }

  if (!iconUrl) {
    return <div className="w-6 h-6 bg-gray-300 rounded-nexus-full" />;
  }

  return <img src={iconUrl} alt={tokenSymbol} className={className} />;
};
