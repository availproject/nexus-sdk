import React from 'react';
import { TokenSelectProps } from '../../types';
import { TOKEN_METADATA, TESTNET_TOKEN_METADATA } from '../../../constants';
import { TokenIcon } from './icons';
import AnimatedSelect from './animated-select';
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
    label: `${token.symbol}`,
    symbol: token.symbol,
    icon: token.icon,
  }));

  const renderSelectedValue = (option: TokenSelectOption) => (
    <div className="h-8 flex items-center gap-1.5">
      <TokenIcon tokenSymbol={option.symbol} />
      <span className="text-black text-base font-semibold font-nexus-primary leading-normal">
        {option.symbol}
      </span>
    </div>
  );

  const renderOption = (option: TokenSelectOption) => (
    <div className="flex items-center gap-2">
      <TokenIcon tokenSymbol={option.symbol} />
      <span>{option.label}</span>
    </div>
  );

  return (
    <AnimatedSelect<TokenSelectOption>
      value={value || ''}
      onSelect={onValueChange}
      disabled={disabled}
      placeholder="Select token..."
      options={tokenOptions}
      renderSelectedValue={renderSelectedValue}
      renderOption={renderOption}
      className={cn(disabled && 'opacity-40', className)}
    />
  );
}
