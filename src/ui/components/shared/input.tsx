import * as React from 'react';

import { cn } from '../../utils/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-nexus-foreground placeholder:text-nexus-muted-foreground  selection:text-nexus-primary-foreground   flex h-12 w-full min-w-0 rounded-nexus-md bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 font-nexus-primary',
        'aria-invalid:ring-nexus-destructive/20 dark:aria-invalid:ring-nexus-destructive/40 aria-invalid:border-nexus-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
