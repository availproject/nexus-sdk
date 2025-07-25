import * as React from 'react';
import { cn } from '../../utils/utils';
import { Input } from './input';

interface AmountInputProps {
  value?: string;
  suffix?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  className?: string;
  placeholder?: string;
  debounceMs?: number;
}

export function AmountInput({
  value,
  suffix,
  disabled = false,
  onChange,
  className,
  placeholder = '0.0',
  debounceMs = 500,
}: AmountInputProps) {
  const [localValue, setLocalValue] = React.useState(value || '');
  const timeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined);

  React.useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const validateNumberInput = (input: string): string => {
    if (input === '') return '';
    if (input === '.') return '0.';
    let cleaned = input.replace(/[^0-9.]/g, '');
    const decimalCount = (cleaned.match(/\./g) || []).length;
    if (decimalCount > 1) {
      const firstDecimalIndex = cleaned.indexOf('.');
      cleaned =
        cleaned.substring(0, firstDecimalIndex + 1) +
        cleaned.substring(firstDecimalIndex + 1).replace(/\./g, '');
    }
    if (cleaned.length > 1 && cleaned[0] === '0' && cleaned[1] !== '.') {
      cleaned = cleaned.replace(/^0+/, '0');
      if (cleaned === '0' && input.length > 1 && input[1] !== '.') {
        cleaned = cleaned.substring(1) || '0';
      }
    }
    const decimalIndex = cleaned.indexOf('.');
    if (decimalIndex !== -1 && cleaned.length - decimalIndex > 19) {
      cleaned = cleaned.substring(0, decimalIndex + 19);
    }

    return cleaned;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const validatedValue = validateNumberInput(rawValue);
    
    setLocalValue(validatedValue);

    if (!onChange) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (validatedValue !== value) {
        onChange(validatedValue);
      }
    }, debounceMs);
  };

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className={cn(
        'px-4 py-2 rounded-nexus-md border border-zinc-400 flex justify-between items-center focus-within:border-ring focus-within:ring-nexus-ring/50 focus-within:ring-[3px]',
        'bg-transparent h-12',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <div className="flex items-center gap-x-1.5 flex-1">
        {onChange ? (
          <Input
            type="text"
            value={localValue}
            onChange={handleInputChange}
            disabled={disabled}
            className=" text-black text-base font-semibold font-nexus-primary leading-normal outline-none px-0"
            placeholder={placeholder}
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
          />
        ) : (
          <div className="text-black text-base font-semibold font-nexus-primary leading-normal">
            {value ?? '0.0'}
          </div>
        )}
      </div>
      {suffix && (
        <div className="flex items-center gap-2">
          <div className="text-zinc-500 text-base font-semibold font-nexus-primary leading-normal">
            {suffix}
          </div>
        </div>
      )}
    </div>
  );
}
