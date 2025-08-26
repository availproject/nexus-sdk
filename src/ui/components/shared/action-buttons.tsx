import * as React from 'react';
import { Button } from '../motion/button-motion';
import { cn } from '../../utils/utils';
import { SmallAvailLogo } from '../icons/SmallAvailLogo';
import LoadingDots from '../motion/loading-dots';

interface ActionButtonsProps {
  onCancel: () => void;
  onPrimary: () => void;
  primaryText?: string;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  className?: string;
}

export function ActionButtons({
  onCancel,
  onPrimary,
  primaryText = 'Continue',
  primaryLoading = false,
  primaryDisabled = false,
  className,
}: ActionButtonsProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-y-2 w-full pt-2 rounded-b-nexus-xl bg-white !shadow-[0px_4.37px_24px_-17.479px_rgba(0,0,0,0.10)]',
        className,
      )}
    >
      <div className="flex w-full gap-x-4 px-6 ">
        <Button
          variant="outline"
          className={cn(
            'flex-1 px-4 py-3 h-auto',
            'rounded-nexus-md',
            'text-base font-semibold font-nexus-primary leading-normal !bg-transparent',
            'border-zinc-400',
            'text-nexus-black hover:text-nexus-muted-foreground',
            'hover:bg-zinc-200',
          )}
          onClick={onCancel}
        >
          Cancel
        </Button>

        <Button
          className={cn(
            'flex-1 items-center justify-center px-4 py-3 h-auto',
            'bg-zinc-800 text-white',
            'rounded-nexus-md',
            'text-base font-semibold font-nexus-primary leading-normal',
            'hover:bg-zinc-700',
            'disabled:opacity-50',
          )}
          onClick={onPrimary}
          disabled={primaryDisabled || primaryLoading}
        >
          {primaryLoading ? <LoadingDots className="translate-x-1/3" /> : primaryText}
        </Button>
      </div>
      <div className="flex items-center justify-center gap-x-1.5 text-xs h-8 bg-nexus-footer w-full rounded-b-nexus-xl">
        <span className="text-nexus-footer-text font-nexus-primary">Powered By</span>
        <SmallAvailLogo />
      </div>
    </div>
  );
}
