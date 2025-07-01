import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '../../utils/utils';

function Progress({
  className,
  value,
  indicatorColor = 'bg-[#56C45B]',
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indicatorColor?: string;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'bg-[#E8EAF0] relative h-2 w-full overflow-hidden rounded-full border border-[#C8C8C8]',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(indicatorColor, 'h-full w-full flex-1 transition-all')}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
