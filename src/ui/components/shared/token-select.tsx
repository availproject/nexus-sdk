import React from 'react';
import { TokenSelectProps } from '../../types';
import { TOKEN_METADATA, TESTNET_TOKEN_METADATA } from '../../../constants';
import { TokenIcon } from './icons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { cn } from '../../utils/utils';

interface TokenSelectOption {
  value: string;
  label: string;
  symbol: string;
  icon: string;
}

export function TokenSelect({
  value,
  onValueChange,
  disabled = false,
  network = 'mainnet',
  className,
}: TokenSelectProps & { network?: 'mainnet' | 'testnet' }) {
  // Get appropriate tokens based on network
  const tokenMetadata = network === 'testnet' ? TESTNET_TOKEN_METADATA : TOKEN_METADATA;

  // Build options from token metadata
  const tokenOptions: TokenSelectOption[] = Object.values(tokenMetadata).map((token) => ({
    value: token.symbol,
    label: token.name,
    symbol: token.symbol,
    icon: token.icon,
  }));

  return (
    <Select value={value || ''} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        className={cn(
          'px-4 py-2 min-h-12 rounded-[8px] border border-zinc-400 w-full cursor-pointer',
          '!bg-transparent flex justify-between items-center',
          'focus:border-ring focus:ring-ring/50 focus:ring-[3px]',
          disabled && 'opacity-40',
          className,
        )}
      >
        <SelectValue placeholder="Select token...">
          {value && (
            <div className="h-8 flex items-center gap-1.5">
              <TokenIcon tokenSymbol={value} />
              <span className="text-black text-base font-semibold nexus-font-primary leading-normal">
                {tokenOptions.find((option) => option.value === value)?.symbol}
              </span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="bg-white">
        {tokenOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="flex items-center gap-2">
              <TokenIcon tokenSymbol={option.symbol} />
              <span>
                {option.symbol} - {option.label}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
