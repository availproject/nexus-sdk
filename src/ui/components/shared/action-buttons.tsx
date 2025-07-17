import * as React from 'react';
import { Button } from './button-motion';
import { cn } from '../../utils/utils';
import { SmallAvailLogo } from '../icons/SmallAvailLogo';
import LoadingDots from './loading-dots';

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
        'flex flex-col items-center gap-y-2 w-full pt-2 rounded-b-xl bg-white !shadow-[0px_4.37px_24px_-17.479px_rgba(0,0,0,0.10)]',
        className,
      )}
    >
      <div className="flex w-full gap-x-4 px-6 ">
        <Button
          variant="outline"
          className={cn(
            'flex-1 px-4 py-3 h-auto',
            'rounded-[8px]',
            'text-base font-semibold nexus-font-primary leading-normal !bg-transparent',
            'border-zinc-400',
            'text-black',
            'hover:bg-zinc-500',
          )}
          onClick={onCancel}
        >
          Cancel
        </Button>

        <Button
          className={cn(
            'flex-1 items-center justify-center px-4 py-3 h-auto',
            'bg-zinc-800 text-white',
            'rounded-[8px]',
            'text-base font-semibold nexus-font-primary leading-normal',
            'hover:bg-zinc-700',
            'disabled:opacity-50',
          )}
          onClick={onPrimary}
          disabled={primaryDisabled || primaryLoading}
        >
          {primaryLoading ? <LoadingDots className="translate-x-1/3" /> : primaryText}
        </Button>
      </div>
      <div className="flex items-center justify-center gap-x-1.5 text-xs h-8 bg-[#BED8EE66] w-full rounded-b-xl">
        <span className="text-[#4C4C4C] nexus-font-primary">Powered By</span>
        <SmallAvailLogo />
      </div>
    </div>
  );
}
