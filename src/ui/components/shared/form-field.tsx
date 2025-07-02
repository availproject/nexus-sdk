import * as React from 'react';
import { cn } from '../../utils/utils';
import { Label } from './label';

interface FormFieldProps {
  label: string;
  children: React.ReactNode;
  helperText?: string;
  className?: string;
}

export function FormField({ label, children, helperText, className }: FormFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label className="text-stone-500 text-sm font-normal font-primary leading-none">
        {label}
      </Label>
      {children}
      {helperText && (
        <div className="text-black text-sm font-normal font-primary leading-none">{helperText}</div>
      )}
    </div>
  );
}
