import React from 'react';
import { ChainSelectProps } from '../../types';
import { CHAIN_METADATA, MAINNET_CHAINS, TESTNET_CHAINS } from '../../../constants';
import { ChainIcon } from './icons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { cn } from '../../utils/utils';

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
}: ChainSelectProps & { network?: 'mainnet' | 'testnet' }) {
  const availableChainIds = network === 'testnet' ? TESTNET_CHAINS : MAINNET_CHAINS;

  const chainOptions: ChainSelectOption[] = availableChainIds.map((chainId) => {
    const metadata = CHAIN_METADATA[chainId];
    return {
      value: chainId.toString(),
      label: metadata.name,
      chainId,
      logo: metadata.logo,
    };
  });

  return (
    <Select value={value || ''} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        className={cn(
          'px-4 py-2 min-h-12 rounded-lg border border-zinc-400 w-full cursor-pointer',
          '!bg-transparent flex justify-between items-center',
          'focus:border-ring focus:ring-ring/50 focus:ring-[3px]',
          disabled && 'opacity-40',
          className,
        )}
      >
        <SelectValue placeholder="Select destination chain...">
          {value && (
            <div className="h-8 flex items-center gap-1.5">
              <ChainIcon chainId={value} />
              <span className="text-black text-base font-semibold font-primary leading-normal">
                {chainOptions.find((option) => option.value === value)?.label}
              </span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="bg-white">
        {chainOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="flex items-center gap-2">
              <ChainIcon chainId={option.value} />
              <span>{option.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
