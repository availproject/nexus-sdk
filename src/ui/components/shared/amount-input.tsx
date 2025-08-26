import * as React from 'react';
import { cn } from '../../utils/utils';
import { Input } from '../motion/input';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { getFiatValue } from '../../utils/balance-utils';

interface AmountInputProps {
  value?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  className?: string;
  placeholder?: string;
  debounceMs?: number;
  token?: string;
}

export function AmountInput({
  value,
  disabled = false,
  onChange,
  className,
  placeholder = '0.0',
  debounceMs = 500,
  token,
}: AmountInputProps) {
  const [localValue, setLocalValue] = React.useState(value || '');
  const timeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined);
  const { exchangeRates } = useInternalNexus();

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
        'flex items-start flex-col gap-y-1 text-left mt-1 w-full',
        disabled && 'pointer-events-none cursor-not-allowed',
        className,
      )}
    >
      <div className="flex items-center gap-x-1">
        {onChange ? (
          <Input
            type="text"
            value={localValue}
            onChange={handleInputChange}
            disabled={disabled}
            className="text-nexus-black text-[32px] font-semibold font-nexus-primary leading-[22px] h-7 outline-none px-0 placeholder:text-nexus-muted-secondary"
            placeholder={placeholder}
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
          />
        ) : (
          <p className="text-nexus-black/40 text-[32px] font-semibold leading-[22px] font-nexus-primary">
            {value ?? 0}
          </p>
        )}
      </div>
      {token && value && (
        <p className="text-nexus-accent-green font-semibold leading-6 text-lg font-nexus-primary">
          {getFiatValue(value, token, exchangeRates)}
        </p>
      )}
    </div>
  );
}
