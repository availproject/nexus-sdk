import * as React from 'react';
import { cn } from '../../utils/utils';
import { Input } from './input';

interface AmountInputProps {
  value?: string;
  suffix?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}

export function AmountInput({
  value,
  suffix,
  disabled = false,
  onChange,
  className,
}: AmountInputProps) {
  const validateNumberInput = (input: string): string => {
    // Allow empty input
    if (input === '') return '';

    // Allow starting with decimal point (e.g., ".5" becomes "0.5")
    if (input === '.') return '0.';

    // Remove any non-numeric characters except decimal point
    let cleaned = input.replace(/[^0-9.]/g, '');

    // Ensure only one decimal point
    const decimalCount = (cleaned.match(/\./g) || []).length;
    if (decimalCount > 1) {
      // Keep only the first decimal point
      const firstDecimalIndex = cleaned.indexOf('.');
      cleaned =
        cleaned.substring(0, firstDecimalIndex + 1) +
        cleaned.substring(firstDecimalIndex + 1).replace(/\./g, '');
    }

    // Prevent leading zeros except for decimal numbers (e.g., "000.5" becomes "0.5", "000" becomes "0")
    if (cleaned.length > 1 && cleaned[0] === '0' && cleaned[1] !== '.') {
      cleaned = cleaned.replace(/^0+/, '0');
      if (cleaned === '0' && input.length > 1 && input[1] !== '.') {
        // If user types something after 0 that's not a decimal, replace the 0
        cleaned = cleaned.substring(1) || '0';
      }
    }

    // Limit decimal places to 18 (reasonable for most tokens)
    const decimalIndex = cleaned.indexOf('.');
    if (decimalIndex !== -1 && cleaned.length - decimalIndex > 19) {
      cleaned = cleaned.substring(0, decimalIndex + 19);
    }

    return cleaned;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onChange) return;

    const rawValue = e.target.value;
    const validatedValue = validateNumberInput(rawValue);

    // Only call onChange if the value actually changed after validation
    if (validatedValue !== value) {
      onChange(validatedValue);
    }
  };

  return (
    <div
      className={cn(
        'px-4 py-2 rounded-lg border border-zinc-400 flex justify-between items-center',
        'bg-transparent h-12',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <div className="flex items-center gap-x-1.5 flex-1">
        {onChange ? (
          <Input
            type="text"
            value={value || ''}
            onChange={handleInputChange}
            disabled={disabled}
            className="!bg-transparent text-black text-base font-semibold font-primary leading-normal border-none !outline-none flex-1 disabled:cursor-not-allowed px-0 !focus-visible:outline-none !focus-within:outline-none"
            placeholder="0.0"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
          />
        ) : (
          <div className="text-black text-base font-semibold font-primary leading-normal">
            {value ?? '0.0'}
          </div>
        )}
      </div>
      {suffix && (
        <div className="flex items-center gap-2">
          <div className="text-zinc-500 text-base font-semibold font-primary leading-normal">
            {suffix}
          </div>
        </div>
      )}
    </div>
  );
}
