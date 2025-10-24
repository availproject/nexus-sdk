import {
  CHAIN_METADATA,
  SUPPORTED_CHAINS,
  TOKEN_METADATA,
  DESTINATION_SWAP_TOKENS,
  type ChainMetadata,
} from '@nexus/commons';
import { cn } from '../../utils/utils';

// Additional token logos that might not be in TOKEN_METADATA
const ADDITIONAL_TOKEN_LOGOS: Record<string, string> = {
  WETH: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png?1595348880',
  USDS: 'https://assets.coingecko.com/coins/images/39926/standard/usds.webp?1726666683',
  SOPH: 'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png',
  KAIA: 'https://assets.coingecko.com/asset_platforms/images/9672/large/kaia.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  // Add ETH as fallback for any ETH-related tokens
  ETH: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
  // Add common token fallbacks
  POL: 'https://coin-images.coingecko.com/coins/images/32440/standard/polygon.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png',
  FUEL: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
  HYPE: 'https://assets.coingecko.com/asset_platforms/images/243/large/hyperliquid.png',
  // Popular swap tokens
  DAI: 'https://coin-images.coingecko.com/coins/images/9956/large/Badge_Dai.png?1696509996',
  UNI: 'https://coin-images.coingecko.com/coins/images/12504/large/uni.jpg?1696512319',
  AAVE: 'https://coin-images.coingecko.com/coins/images/12645/large/AAVE.png?1696512452',
  LDO: 'https://coin-images.coingecko.com/coins/images/13573/large/Lido_DAO.png?1696513326',
  PEPE: 'https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg?1696528776',
  OP: 'https://coin-images.coingecko.com/coins/images/25244/large/Optimism.png?1696524385',
  ZRO: 'https://coin-images.coingecko.com/coins/images/28206/large/ftxG9_TJ_400x400.jpeg?1696527208',
  OM: 'https://assets.coingecko.com/coins/images/12151/standard/OM_Token.png?1696511991',
  KAITO: 'https://assets.coingecko.com/coins/images/54411/standard/Qm4DW488_400x400.jpg',
};

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

  // Comprehensive icon resolution logic
  if (!finalIconUrl) {
    // 1. First check additional token logos (prioritize over TOKEN_METADATA for better icons)
    finalIconUrl = ADDITIONAL_TOKEN_LOGOS[tokenSymbol];

    // 2. Then check standard TOKEN_METADATA
    if (!finalIconUrl) {
      const standardToken = TOKEN_METADATA[tokenSymbol];
      finalIconUrl = standardToken?.icon;
    }

    // 3. Check destination swap tokens
    if (!finalIconUrl) {
      const allDestinationTokens = Array.from(DESTINATION_SWAP_TOKENS.values()).flat();
      const destinationToken = allDestinationTokens.find((token) => token.symbol === tokenSymbol);
      finalIconUrl = destinationToken?.logo;
    }

    // 4. Special handling for wrapped tokens
    if (!finalIconUrl && tokenSymbol.startsWith('W') && tokenSymbol.length > 1) {
      const baseSymbol = tokenSymbol.substring(1); // Remove 'W' prefix
      finalIconUrl = ADDITIONAL_TOKEN_LOGOS[baseSymbol];
    }

    // 5. ETH fallback for any ethereum-related tokens
    if (!finalIconUrl && (tokenSymbol.includes('ETH') || tokenSymbol === 'WETH')) {
      finalIconUrl = ADDITIONAL_TOKEN_LOGOS['ETH'];
    }
  }

  // Fallback placeholder with first letter of token symbol
  if (!finalIconUrl) {
    return (
      <div
        className={cn(
          'bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-gray-600 font-semibold text-xs',
          className,
        )}
      >
        {tokenSymbol.charAt(0).toUpperCase()}
      </div>
    );
  }

  return <img src={finalIconUrl} alt={tokenSymbol} className={className} />;
};
