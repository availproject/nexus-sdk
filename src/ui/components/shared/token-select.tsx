import React, { useMemo } from 'react';
import { TokenSelectProps } from '../../types';
import { TOKEN_METADATA, TESTNET_TOKEN_METADATA } from '../../../constants';
import { TokenIcon } from './icons';
import { cn } from '../../utils/utils';
import { Button } from '../motion/button-motion';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { DrawerAutoClose } from '../motion/drawer';

interface TokenSelectOption {
  value: string;
  label: string;
  icon: string;
}

export function TokenSelect({
  value,
  onValueChange,
  disabled = false,
  network = 'mainnet',
  className,
  hasValues,
}: TokenSelectProps & { network?: 'mainnet' | 'testnet' }) {
  const { unifiedBalance } = useInternalNexus();
  const tokenMetadata = network === 'testnet' ? TESTNET_TOKEN_METADATA : TOKEN_METADATA;

  const tokenOptions: TokenSelectOption[] = Object.values(tokenMetadata).map((token) => ({
    value: token.symbol,
    label: `${token.symbol}`,
    icon: token.icon,
  }));

  const tokenBalanceBreakdown = useMemo(() => {
    let breakdown: Record<string, { bal: string; chains: string }> = {};
    unifiedBalance?.map((balance) => {
      const key = balance?.symbol;
      breakdown[key] = {
        bal: parseFloat(balance?.balance) > 0 ? balance?.balance : '00',
        chains: `${balance?.breakdown?.length > 1 ? balance?.breakdown?.length + ' chains' : balance?.breakdown?.length > 0 ? balance?.breakdown?.length + ' chain' : '-'}`,
      };
    });
    return breakdown;
  }, [unifiedBalance]);

  const selectedOption = useMemo(
    () => tokenOptions.find((opt) => opt.value === (value ?? '')),
    [value],
  );

  const handleSelect = (chainId: string) => {
    if (disabled) return;
    onValueChange(chainId);
  };

  return (
    <div className={cn('flex flex-col items-start gap-y-4 py-5 pl-4 w-full', className)}>
      <p className="text-nexus-foreground text-lg font-semibold ">Destination Token</p>
      {tokenOptions.map((token) => (
        <DrawerAutoClose key={token?.label} enabled={hasValues}>
          <Button
            variant="custom"
            size="custom"
            onClick={() => handleSelect(token?.value)}
            className={cn(
              'w-full  p-3 rounded-nexus-md hover:bg-nexus-accent-green/10',
              disabled && 'pointer-events-none cursor-not-allowed opacity-50 text-nexus-foreground',
              selectedOption?.value === token?.value ? 'bg-nexus-accent-green/10' : '',
            )}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-start gap-x-2">
                <TokenIcon tokenSymbol={token?.value} />
                <p className="font-semibold font-nexus-primary text-sm text-nexus-foreground">
                  {token?.label}
                </p>
              </div>
              <div className="flex flex-col items-end gap-y-2">
                <p className="font-semibold font-nexus-primary text-sm text-nexus-foreground">
                  {parseFloat(tokenBalanceBreakdown[token?.value]?.bal ?? '0').toFixed(6)}
                </p>
                <p className="font-semibold font-nexus-primary text-sm text-nexus-secondary ">
                  {tokenBalanceBreakdown[token?.value]?.chains}
                </p>
              </div>
            </div>
          </Button>
        </DrawerAutoClose>
      ))}
    </div>
  );
}
