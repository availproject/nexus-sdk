import * as React from 'react';
import { cn } from '../../utils/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const infoMessageVariants = cva('px-2 py-3 rounded-[8px] overflow-hidden nexus-font-primary', {
  variants: {
    variant: {
      success: 'bg-[#78c47b29] text-black',
      info: 'bg-blue-50 text-black',
      warning: 'bg-yellow-50 text-black',
      error: 'bg-[#C03C541A] text-[#C03C54]',
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
          <div className="flex-1 text-sm font-semibold nexus-font-primary leading-normal ">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
