import { useMemo } from 'react';
import { ChainSelectProps } from '../../types';
import { CHAIN_METADATA, MAINNET_CHAINS, TESTNET_CHAINS } from '@nexus/commons';
import { ChainIcon } from './icons';
import { cn } from '../../utils/utils';
import { Button } from '../motion/button-motion';
import { DrawerAutoClose } from '../motion/drawer';
import { getFilteredChainsForToken } from '../../utils/token-utils';
import type { TransactionType } from '../../utils/balance-utils';

interface ChainSelectOption {
  value: string;
  label: string;
  chainId: number;
  logo: string;
}

export function ChainSelect({
  value,
  onValueChange,
  disabled = false,
  network = 'mainnet',
  className,
  hasValues,
  isSource,
  selectedToken,
  transactionType,
}: ChainSelectProps & {
  network?: 'mainnet' | 'testnet';
  selectedToken?: string;
  transactionType?: TransactionType;
}) {
  const availableChainIds = network === 'testnet' ? TESTNET_CHAINS : MAINNET_CHAINS;

  // Filter chains based on selected token for swaps
  const filteredChainIds = useMemo(() => {
    if (selectedToken && transactionType === 'swap') {
      return getFilteredChainsForToken(selectedToken, [...availableChainIds], transactionType);
    }
    return [...availableChainIds];
  }, [selectedToken, transactionType, availableChainIds]);

  const chainOptions: ChainSelectOption[] = filteredChainIds.map((chainId) => {
    const metadata = CHAIN_METADATA[chainId];
    return {
      value: chainId.toString(),
      label: metadata.name,
      chainId,
      logo: metadata.logo,
    };
  });

  const selectedOption = useMemo(
    () => chainOptions.find((opt) => opt.value === (value ?? '')),
    [value],
  );

  const handleSelect = (chainId: string) => {
    if (disabled) return;
    onValueChange(chainId);
  };

  // Check if current selection is still valid after filtering
  const isCurrentSelectionValid = useMemo(() => {
    if (!value) return true;
    return chainOptions.some((option) => option.value === value);
  }, [value, chainOptions]);

  return (
    <div
      className={cn(
        'flex flex-col items-start gap-y-4 py-5 border-r border-nexus-muted-secondary/20 max-w-max pr-4 ',
        className,
      )}
    >
      <div className="flex flex-col gap-y-1">
        <p className="text-nexus-foreground text-lg font-semibold ">
          {isSource ? 'Source' : 'Destination'} Chain
        </p>
        {selectedToken && transactionType === 'swap' && !isCurrentSelectionValid && (
          <p className="text-nexus-accent-red text-xs font-medium">
            Current chain doesn't support {selectedToken}
          </p>
        )}
      </div>
      <div className="flex flex-col items-start w-full h-full max-h-[332px] overflow-y-scroll gap-y-4">
        {chainOptions.map((chain, index) => (
          <DrawerAutoClose key={chain?.chainId} enabled={hasValues}>
            <Button
              variant="custom"
              size="custom"
              onClick={() => handleSelect(chain?.chainId.toString())}
              className={cn(
                'p-3 flex items-center justify-start gap-x-2 rounded-nexus-md border border-nexus-border w-full hover:bg-nexus-accent-green/10',
                disabled &&
                  'pointer-events-none cursor-not-allowed opacity-50 text-nexus-foreground ',
                selectedOption?.chainId === chain?.chainId ? 'bg-nexus-accent-green/10' : '',
                index === chainOptions.length - 1 ? 'mb-20' : '',
              )}
            >
              <ChainIcon chainId={chain?.chainId.toString()} />
              <p className="text-nexus-foreground font-semibold font-nexus-primary text-sm">
                {chain?.label}
              </p>
            </Button>
          </DrawerAutoClose>
        ))}
      </div>
    </div>
  );
}
