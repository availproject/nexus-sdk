import * as React from 'react';
import { cn } from '../../utils/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const infoMessageVariants = cva(
  'px-2 py-3 rounded-lg border-b-2 backdrop-blur-[48.07px] overflow-hidden',
  {
    variants: {
      variant: {
        success: 'bg-[#22C55E]/20 border-green-300 text-black',
        info: 'bg-blue-50 border-blue-300',
        warning: 'bg-yellow-50 border-yellow-300',
        error: 'bg-[#C03C541A] border-red-300 text-[#C03C54]',
      },
    },
    defaultVariants: {
      variant: 'success',
    },
  },
);

interface InfoMessageProps extends VariantProps<typeof infoMessageVariants> {
  children: React.ReactNode;
  className?: string;
}

export function InfoMessage({ variant, children, className }: InfoMessageProps) {
  return (
    <div className={cn('px-6', className)}>
      <div className={cn(infoMessageVariants({ variant }))}>
        <div className="flex items-center gap-1">
          <div className="flex-1 text-sm font-semibold font-primary leading-normal ">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
