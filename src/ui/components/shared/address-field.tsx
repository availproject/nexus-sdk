import * as React from 'react';
import { FormField } from './form-field';
import { Input } from './input';
import { cn } from '../../utils/utils';

interface AddressFieldProps {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function AddressField({
  label,
  value,
  onChange,
  disabled = false,
  placeholder = '0x...',
  className,
}: AddressFieldProps) {
  const validateAddress = (address: string): boolean => {
    if (!address) return true;
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const hasValidationError = value && !validateAddress(value);

  return (
    <FormField
      label={label}
      className="flex-1"
      helperText={hasValidationError ? 'Invalid address format (must be 0x...)' : undefined}
    >
      <div
        className={cn(
          'px-4 py-2 rounded-[8px] border border-zinc-400 font-semibold flex justify-between items-center',
          'bg-transparent h-12',
          'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
          disabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
      >
        <div className="flex items-center gap-x-1.5 flex-1">
          <Input
            placeholder={placeholder}
            value={value || ''}
            onChange={(e) => onChange?.(e.target.value)}
            disabled={disabled}
            className={cn(
              'px-0 placeholder:nexus-font-primary',
              hasValidationError ? 'border-red-500 focus:border-red-500' : '',
            )}
          />
        </div>
      </div>
    </FormField>
  );
}
