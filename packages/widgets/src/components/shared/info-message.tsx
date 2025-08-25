import * as React from 'react';
import { cn } from '../../utils/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const infoMessageVariants = cva(
  'px-2 py-3 rounded-nexus-md overflow-hidden font-nexus-primary font-semibold text-sm leading-[18px] backdrop-blur-[48px] border border-nexus-black/80',
  {
    variants: {
      variant: {
        success: 'bg-gradient-to-r from-[#86DF00]/16 to-[#73BF01]/16 text-nexus-black',
        info: 'bg-blue-50 text-nexus-black',
        warning: 'bg-gradient-to-r from-[#DFC200]/16 to-[#DFC200]/16 text-nexus-black',
        error: 'bg-[#C03C541A] text-[#C03C54] border border-[#C03C541A]',
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
          <div className="flex-1 text-sm font-semibold font-nexus-primary leading-normal">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
