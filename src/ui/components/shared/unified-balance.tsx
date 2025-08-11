import React, { useMemo } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '../motion/drawer';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { SUPPORTED_TOKENS, UserAsset } from '../../../types';
import SolarWallet from '../icons/SolarWallet';
import { ChevronDownIcon, CircleX } from '../icons';
import { CHAIN_METADATA, SUPPORTED_CHAINS, TOKEN_METADATA } from '../../../constants';
import { cn } from '../../utils/utils';

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
          <ChevronDownIcon size={24} />
        </div>
      )}
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
            'w-6 h-6',
            balance.chain.id !== SUPPORTED_CHAINS.BASE &&
              balance?.chain?.id !== SUPPORTED_CHAINS?.BASE_SEPOLIA
              ? 'rounded-full'
              : '',
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
          {parseFloat(balance.balance).toFixed(6)}
        </p>
        <p className="text-sm text-nexus-muted-foreground font-nexus-primary">
          ≈ ${balance.balanceInFiat}
        </p>
      </div>
    </div>
  );
};

const UnifiedBalance = ({ isBusy }: { isBusy: boolean }) => {
  const { unifiedBalance, activeTransaction } = useInternalNexus();
  const { inputData } = activeTransaction;
  const tokenSymbol = inputData?.token;

  // Hooks must not be conditional. Compute memoized values before any early returns.
  const relevantBalance = useMemo(() => {
    if (!unifiedBalance || !tokenSymbol) return [] as UserAsset[];
    return unifiedBalance.filter((balance) => balance?.symbol === tokenSymbol);
  }, [tokenSymbol, unifiedBalance]);

  const tokenBalance = relevantBalance[0];

  if (!unifiedBalance) return null;

  if (!tokenSymbol)
    return (
      <div className="px-6 font-nexus-primary w-full my-6">
        <BalanceTrigger />
      </div>
    );

  if (!tokenBalance) return null;

  return (
    <Drawer>
      <DrawerTrigger className="px-6 font-nexus-primary w-full my-6" disabled={isBusy}>
        <BalanceTrigger balance={tokenBalance} token={inputData?.token} />
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
                src={TOKEN_METADATA[tokenSymbol]?.icon}
                alt={TOKEN_METADATA[tokenSymbol]?.name}
                className="w-6 h-6 border border-nexus-border-secondary rounded-full"
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
          <div className="space-y-2.5 mt-2.5">
            {tokenBalance.breakdown?.map((breakdownBalance, index: number) => (
              <ChainBalance
                key={`${breakdownBalance.chain?.id}-${index}`}
                balance={breakdownBalance}
                symbol={tokenSymbol || ''}
              />
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default UnifiedBalance;
