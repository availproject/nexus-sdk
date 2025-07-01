import * as React from 'react';
import { Button } from './button';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/utils';
import { SmallAvailLogo } from './icons/SmallAvailLogo';

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
    <div className={cn('flex flex-col items-center gap-y-2 w-full pt-2 rounded-b-xl', className)}>
      <div className="flex w-full gap-x-4 px-6">
        <Button
          variant="outline"
          className={cn(
            'flex-1 px-4 py-3 h-auto',
            'rounded-lg',
            'text-base font-semibold font-primary leading-normal',
            'border-zinc-400',
            'text-black',
            'hover:bg-gray-50',
          )}
          onClick={onCancel}
        >
          Cancel
        </Button>

        <Button
          className={cn(
            'flex-1 px-4 py-3 h-auto',
            'bg-zinc-800 text-white',
            'rounded-lg',
            'text-base font-semibold font-primary leading-normal',
            'hover:bg-zinc-700',
            'disabled:opacity-50',
          )}
          onClick={onPrimary}
          disabled={primaryDisabled || primaryLoading}
        >
          {primaryLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {primaryText}
        </Button>
      </div>
      <div className="flex items-center justify-center gap-x-1.5 text-xs h-8 bg-[#BED8EE66] w-full rounded-b-xl">
        <span className="text-[#4C4C4C] font-primary">Powered By</span>
        <SmallAvailLogo />
      </div>
    </div>
  );
}
