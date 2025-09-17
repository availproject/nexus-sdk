import { useMemo } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '../motion/drawer';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import {
  type SUPPORTED_TOKENS,
  type UserAsset,
  CHAIN_METADATA,
  SUPPORTED_CHAINS,
  TOKEN_METADATA,
} from '@nexus/commons';
import SolarWallet from '../icons/SolarWallet';
import { ChevronDownIcon, CircleX } from '../icons';
import { cn, getTokenFromInputData } from '../../utils/utils';
import { TOKEN_IMAGE_MAP } from '../../utils/balance-utils';

const BalanceTrigger = ({ balance, token }: { balance?: UserAsset; token?: SUPPORTED_TOKENS }) => {
  return (
    <div className="px-2 py-3 rounded-nexus-md border border-nexus-muted-secondary/20 bg-nexus-gray backdrop-blur-2xl h-14 flex items-center justify-between">
      <div className="flex items-center justify-start gap-x-2 text-nexus-muted-secondary">
        <SolarWallet />
        {balance && token ? (
          <div className="flex flex-col items-start">
            <p className="text-sm font-semibold font-nexus-primary">Total {token}</p>
            <p className="text-sm font-semibold font-nexus-primary">
              accross {balance?.breakdown?.length} chains
            </p>
          </div>
        ) : (
          <p>Select token to view cross chain balance</p>
        )}
      </div>
      {balance && token && (
        <div className="flex items-center justify-start gap-x-2 ">
          <div className="flex flex-col items-start">
            <p className="text-base font-semibold font-nexus-primary text-nexus-black">
              {parseFloat(balance?.balance).toFixed(6)} {token}
            </p>
            <p className="text-nexus-accent-green font-semibold text-xs font-nexus-primary w-full text-right">
              ≈ ${balance?.balanceInFiat}
            </p>
          </div>
          <ChevronDownIcon size={24} className="text-nexus-foreground" />
        </div>
      )}
    </div>
  );
};

const AllBalancesTrigger = ({ balances }: { balances: UserAsset[] }) => {
  const totalFiat = useMemo(() => {
    return balances?.reduce((sum, asset) => sum + (asset?.balanceInFiat || 0), 0) || 0;
  }, [balances]);

  const { tokenCount, uniqueChainCount } = useMemo(() => {
    const chains = new Set<number>();
    balances?.forEach((asset) => {
      asset?.breakdown?.forEach((b) => {
        if (b?.chain?.id != null) chains.add(b.chain.id);
      });
    });
    return { tokenCount: balances?.length || 0, uniqueChainCount: chains.size };
  }, [balances]);

  return (
    <div className="px-2 py-3 rounded-nexus-md border border-nexus-muted-secondary/20 bg-nexus-gray backdrop-blur-2xl h-14 flex items-center justify-between">
      <div className="flex items-center justify-start gap-x-2 text-nexus-muted-secondary">
        <SolarWallet />
        <div className="flex flex-col items-start">
          <p className="text-sm font-semibold font-nexus-primary">Unified Balance</p>
          <p className="text-sm font-semibold font-nexus-primary">
            across {tokenCount} tokens • {uniqueChainCount} chains
          </p>
        </div>
      </div>
      <div className="flex items-center justify-start gap-x-2 ">
        <div className="flex flex-col items-end">
          <p className="text-nexus-accent-green font-semibold text-lg font-nexus-primary w-full text-right">
            ≈ ${totalFiat.toFixed(2)}
          </p>
        </div>
        <ChevronDownIcon size={24} className="text-nexus-foreground" />
      </div>
    </div>
  );
};

const ChainBalance = ({
  balance,
  symbol,
}: {
  balance: {
    balance: string;
    balanceInFiat: number;
    chain: {
      id: number;
      logo: string;
      name: string;
    };
    contractAddress: `0x${string}`;
    decimals: number;
    isNative?: boolean;
  };
  symbol: string;
}) => {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <img
          src={CHAIN_METADATA[balance.chain.id]?.logo}
          alt={CHAIN_METADATA[balance.chain.id]?.name}
          className={cn(
            '',
            balance.chain.id !== SUPPORTED_CHAINS.BASE &&
              balance?.chain?.id !== SUPPORTED_CHAINS?.BASE_SEPOLIA
              ? 'rounded-full w-6 h-6'
              : 'w-5 h-5',
          )}
        />
        <div className="flex flex-col">
          <p className="text-sm font-semibold text-nexus-muted-foreground font-nexus-primary">
            {symbol}
          </p>
          <p className="text-xs font-semibold text-nexus-muted-foreground font-nexus-primary">
            on {balance.chain?.name || `Chain ${balance.chain?.id}`}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end">
        <p className="text-sm font-semibold text-nexus-black font-nexus-primary">
          {parseFloat(balance.balance).toFixed(2)}
        </p>
        <p className="text-sm text-nexus-muted-foreground font-nexus-primary">
          ${balance.balanceInFiat}
        </p>
      </div>
    </div>
  );
};

const UnifiedBalance = () => {
  const { unifiedBalance, activeTransaction } = useInternalNexus();
  const { inputData } = activeTransaction;
  const tokenSymbol = getTokenFromInputData(inputData);

  const relevantBalance = useMemo(() => {
    if (!unifiedBalance || !tokenSymbol) return [] as UserAsset[];
    return unifiedBalance.filter((balance) => balance?.symbol === tokenSymbol);
  }, [tokenSymbol, unifiedBalance]);

  const tokenBalance = relevantBalance[0];

  if (!unifiedBalance) return null;

  if (!tokenSymbol)
    return (
      <Drawer>
        <DrawerTrigger className="px-6 font-nexus-primary w-full my-6 text-nexus-foreground">
          <AllBalancesTrigger balances={unifiedBalance} />
        </DrawerTrigger>
        <DrawerContent className="font-nexus-primary">
          <DrawerHeader className="px-4 pt-4 pb-0">
            <div className="flex items-center justify-between mb-4 ">
              <DrawerTitle className="font-nexus-primary">Balances Across Tokens</DrawerTitle>
              <DrawerClose>
                <CircleX className="w-6 h-6 text-nexus-black hover:text-zinc-700 transition-colors" />
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="px-4 pb-4 no-scrollbar space-y-4">
            {unifiedBalance.map((asset) => {
              const symbol = asset.symbol;
              const icon = TOKEN_IMAGE_MAP[symbol] || (asset as any)?.icon;
              return (
                <div
                  key={symbol}
                  className="border-b border-gray-200 pb-3 last:border-none last:pb-0"
                >
                  <div className="py-4 w-full flex items-center justify-between">
                    <div className="flex items-center gap-x-3">
                      {icon ? (
                        <img
                          src={icon}
                          alt={symbol}
                          className="w-6 h-6 border border-nexus-border-secondary/10 rounded-full"
                        />
                      ) : null}
                      <p className="text-sm font-semibold text-nexus-muted-secondary leading-[18px] font-nexus-primary">
                        Total {symbol}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-y-2">
                      <p className="text-base font-semibold text-nexus-foreground font-nexus-primary">
                        {parseFloat(asset.balance) > 0
                          ? parseFloat(asset.balance).toFixed(2)
                          : '0.00'}{' '}
                        {symbol}
                      </p>
                      <p className="text-nexus-accent-green font-semibold font-nexus-primary text-sm leading-0">
                        ≈ ${asset.balanceInFiat}
                      </p>
                    </div>
                  </div>

                  {parseFloat(asset.balance) > 0 && (
                    <div className="space-y-2.5 mt-2.5">
                      {asset.breakdown?.map((breakdownBalance, index: number) => (
                        <ChainBalance
                          key={`${breakdownBalance.chain?.id}-${index}-${symbol}`}
                          balance={breakdownBalance}
                          symbol={symbol || ''}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    );

  if (!tokenBalance) return null;

  return (
    <Drawer>
      <DrawerTrigger className="px-6 font-nexus-primary w-full my-6">
        <BalanceTrigger balance={tokenBalance} token={getTokenFromInputData(inputData) as SUPPORTED_TOKENS} />
      </DrawerTrigger>
      <DrawerContent className="font-nexus-primary">
        <DrawerHeader className="px-4 pt-4 pb-0">
          <div className="flex items-center justify-between mb-4 ">
            <DrawerTitle className="font-nexus-primary">Balance Across Chains</DrawerTitle>
            <DrawerClose>
              <CircleX className="w-6 h-6 text-nexus-black hover:text-zinc-700 transition-colors" />
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="px-4 pb-4 no-scrollbar">
          {/* Total Balance */}
          <div className="py-4 mb-0.5 w-full flex items-center justify-between border-b border-gray-200">
            <div className="flex items-center gap-x-3">
              <img
                src={TOKEN_IMAGE_MAP[tokenSymbol]}
                alt={TOKEN_METADATA[tokenSymbol]?.name}
                className="w-6 h-6 border border-nexus-border-secondary/10 rounded-full"
              />
              <p className="text-sm font-semibold text-nexus-muted-secondary leading-[18px] font-nexus-primary">
                Total {tokenSymbol}
              </p>
            </div>
            <div className="flex flex-col items-end gap-y-2">
              <p className="text-base font-semibold text-nexus-foreground font-nexus-primary">
                {parseFloat(tokenBalance.balance).toFixed(6)} {tokenSymbol}
              </p>
              <p className="text-nexus-accent-green font-semibold font-nexus-primary text-xs leading-0">
                ≈ ${tokenBalance.balanceInFiat}
              </p>
            </div>
          </div>

          {/* Individual Chain Balances */}
          {parseFloat(tokenBalance.balance) > 0 && (
            <div className="space-y-2.5 mt-2.5">
              {tokenBalance.breakdown?.map((breakdownBalance, index: number) => (
                <ChainBalance
                  key={`${breakdownBalance.chain?.id}-${index}`}
                  balance={breakdownBalance}
                  symbol={tokenSymbol || ''}
                />
              ))}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default UnifiedBalance;
