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
  iconUrl,
  className = 'w-6 h-6 rounded-nexus-full',
}: {
  tokenSymbol: string;
  iconUrl?: string;
  className?: string;
}) => {
  let finalIconUrl = iconUrl;

  // If no URL is provided, fall back to the old lookup logic
  if (!finalIconUrl) {
    const standardToken = TOKEN_METADATA[
      tokenSymbol as keyof typeof TOKEN_METADATA
    ] as TokenMetadata;
    finalIconUrl = standardToken?.icon;

    if (!finalIconUrl) {
      const allDestinationTokens = Array.from(DESTINATION_SWAP_TOKENS.values()).flat();
      const destinationToken = allDestinationTokens.find((token) => token.symbol === tokenSymbol);
      finalIconUrl = destinationToken?.logo;
    }
  }

  if (!finalIconUrl) {
    return <div className="w-6 h-6 bg-gray-300 rounded-nexus-full" />;
  }

  return <img src={finalIconUrl} alt={tokenSymbol} className={className} />;
};
