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
import { CircleX } from '../icons';

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

export const DestinationDrawer = ({
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
      <DrawerTrigger>
        <p>hi</p>
      </DrawerTrigger>
      <DrawerContent className="font-nexus-primary">
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

        <div className="px-4 pb-4 space-y-4">
          <ChainSelect
            value={chainValue}
            onValueChange={onChainValueChange}
            disabled={isChainSelectDisabled}
            network={network}
            className="w-full"
          />
          <TokenSelect
            value={tokenValue}
            onValueChange={onTokenValueChange}
            disabled={isTokenSelectDisabled}
            network={network}
            className="w-full"
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
};
