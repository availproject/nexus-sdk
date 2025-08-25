import { Input } from '../motion/input';
import { cn } from '../../utils/utils';

interface AddressFieldProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  hasValidationError?: boolean;
}

export function AddressField({
  value,
  onChange,
  disabled = false,
  placeholder = '0x...',
  className,
  hasValidationError = false,
}: AddressFieldProps) {
  return (
    <div
      className={cn(
        'px-4 py-2 rounded-nexus-md border border-nexus-muted-secondary/20 font-semibold flex justify-between items-center',
        'bg-transparent h-12',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <div className="flex items-center gap-x-1.5 flex-1">
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          className={cn(
            'px-0 placeholder:font-nexus-primary text-nexus-black font-semibold text-base',
            hasValidationError ? 'border-red-500 focus:border-red-500' : '',
          )}
        />
      </div>
    </div>
  );
}
