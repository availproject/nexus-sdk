import React from 'react';
import { ChainSelect } from './chain-select';
import { TokenSelect } from './token-select';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '../motion/drawer';
import { ChevronDownIcon, CircleX } from '../icons';
import { FormField } from '../motion/form-field';
import { CHAIN_METADATA, SUPPORTED_CHAINS, TOKEN_METADATA } from '../../../constants';
import { cn } from '../../utils/utils';

interface DestinationDrawerProps {
  chainValue?: string;
  tokenValue?: string;
  isChainSelectDisabled?: boolean;
  isTokenSelectDisabled?: boolean;
  network?: 'mainnet' | 'testnet';
  onChainValueChange: (chain: string) => void;
  onTokenValueChange: (token: string) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const DestinationTrigger = ({
  chainValue,
  tokenValue,
}: {
  chainValue?: string;
  tokenValue?: string;
}) => {
  const chainId = chainValue ? parseInt(chainValue) : undefined;

  return (
    <FormField label={'Destination'} className="flex-1 font-nexus-primary gap-y-2 w-full">
      <div
        className="flex items-center justify-between py-2 px-4 gap-x-2 rounded-nexus-full border border-nexus-muted-secondary/20 bg-nexus-background w-full"
        style={{
          boxShadow:
            '0 4px 21.1px 0 rgba(0, 0, 0, 0.05), 0 7px 11px 0 rgba(255, 255, 255, 0.40) inset',
        }}
      >
        <div className="flex items-center gap-x-3">
          <div className="relative">
            {tokenValue ? (
              <img
                src={TOKEN_METADATA[tokenValue]?.icon}
                alt={TOKEN_METADATA[tokenValue]?.name}
                className="rounded-full size-10 border border-nexus-border-secondary/10"
              />
            ) : (
              <div className="size-10 rounded-full bg-nexus-secondary-background"></div>
            )}
            {chainId ? (
              <img
                src={CHAIN_METADATA[chainId]?.logo}
                alt={CHAIN_METADATA[chainId]?.name}
                className={cn(
                  ' absolute bottom-0 -right-1',
                  chainId !== SUPPORTED_CHAINS?.BASE && chainId !== SUPPORTED_CHAINS?.BASE_SEPOLIA
                    ? 'rounded-full size-6'
                    : 'size-5',
                )}
              />
            ) : (
              <div className="size-6 absolute bottom-0 right-0 rounded-full bg-nexus-black/20" />
            )}
          </div>
          <div className="flex flex-col items-start gap-y-1">
            <p className="text-nexus-black font-semibold font-nexus-primary text-base text-left">
              {tokenValue ? tokenValue : 'Token'}
            </p>
            <p className="text-nexus-muted text-xs font-semibold font-nexus-primary text-left">
              {chainId ? CHAIN_METADATA[chainId]?.name : 'Chain'}
            </p>
          </div>
        </div>
        <ChevronDownIcon size={24} className="text-nexus-muted" />
      </div>
    </FormField>
  );
};

const DestinationDrawer = ({
  chainValue,
  tokenValue,
  isChainSelectDisabled,
  isTokenSelectDisabled,
  network,
  onChainValueChange,
  onTokenValueChange,
}: DestinationDrawerProps) => {
  return (
    <Drawer>
      <DrawerTrigger disabled={isChainSelectDisabled && isTokenSelectDisabled}>
        <DestinationTrigger chainValue={chainValue} tokenValue={tokenValue} />
      </DrawerTrigger>
      <DrawerContent className="font-nexus-primary" contentClassName="overflow-hidden">
        <DrawerHeader className="px-4 pt-4 pb-0">
          <div className="flex items-center justify-between mb-4">
            <DrawerTitle className="font-nexus-primary">
              Select Destination Chain & Token
            </DrawerTitle>
            <DrawerClose>
              <CircleX className="w-6 h-6 text-nexus-black hover:text-zinc-700 transition-colors" />
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="px-4 pb-4 flex flex-1 items-start border-t border-nexus-muted-secondary/20">
          <ChainSelect
            value={chainValue}
            onValueChange={onChainValueChange}
            disabled={isChainSelectDisabled}
            network={network}
            className="w-full"
            hasValues={!!tokenValue}
          />
          <TokenSelect
            value={tokenValue}
            onValueChange={onTokenValueChange}
            disabled={isTokenSelectDisabled}
            network={network}
            className="w-full"
            hasValues={!!chainValue}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default DestinationDrawer;
