import React from 'react';
import { ChainSelectProps } from '../../types';
import { CHAIN_METADATA, MAINNET_CHAINS, TESTNET_CHAINS } from '../../../constants';
import { ChainIcon } from './icons';
import AnimatedSelect from './animated-select';
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

  const renderSelectedValue = (option: ChainSelectOption) => (
    <div className="h-8 flex items-center gap-1.5">
      <ChainIcon chainId={option.value} />
      <span className="text-black text-base font-semibold nexus-font-primary leading-normal">
        {option.label}
      </span>
    </div>
  );

  const renderOption = (option: ChainSelectOption) => (
    <div className="flex items-center gap-2">
      <ChainIcon chainId={option.value} />
      <span>{option.label}</span>
    </div>
  );

  return (
    <AnimatedSelect<ChainSelectOption>
      value={value || ''}
      onSelect={onValueChange}
      disabled={disabled}
      placeholder="Select destination"
      options={chainOptions}
      renderSelectedValue={renderSelectedValue}
      renderOption={renderOption}
      className={cn(disabled && 'opacity-40', className)}
    />
  );
}
