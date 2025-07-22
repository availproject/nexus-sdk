import * as React from 'react';
import { cn } from '../../utils/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const infoMessageVariants = cva('px-2 py-3 rounded-nexus-md overflow-hidden font-nexus-primary', {
  variants: {
    variant: {
      success: 'bg-nexus-success/16 text-gray-900',
      info: 'bg-blue-50 text-gray-900',
      warning: 'bg-yellow-50 text-gray-900',
      error: 'bg-red-50 text-red-600',
    },
  },
  defaultVariants: {
    variant: 'success',
  },
});

interface InfoMessageProps extends VariantProps<typeof infoMessageVariants> {
  children: React.ReactNode;
  className?: string;
}

export function InfoMessage({ variant, children, className }: InfoMessageProps) {
  return (
    <div className={cn('px-6', className)}>
      <div className={cn(infoMessageVariants({ variant }))}>
        <div className="flex items-center gap-1">
          <div className="flex-1 text-sm font-semibold font-nexus-primary leading-normal ">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
