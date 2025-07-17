import * as React from 'react';
import { cn } from '../../utils/utils';

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  htmlFor?: string;
}

function Label({ className, htmlFor, ...props }: LabelProps) {
  return (
    <label
      data-slot="label"
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      htmlFor={htmlFor}
      {...props}
    />
  );
}

export { Label };