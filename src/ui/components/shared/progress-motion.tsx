import * as React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../utils/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  indicatorColor?: string;
}

function Progress({
  className,
  value = 0,
  max = 100,
  indicatorColor = 'bg-[#56C45B]',
  ...props
}: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div
      data-slot="progress"
      className={cn(
        'bg-[#E8EAF0] relative h-2 w-full overflow-hidden rounded-full border border-[#C8C8C8]',
        className,
      )}
      {...props}
    >
      <motion.div
        data-slot="progress-indicator"
        className={cn(indicatorColor, 'h-full origin-left')}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: percentage / 100 }}
        transition={{ 
          duration: 0.3,
          ease: [0.4, 0.0, 0.2, 1]
        }}
        style={{ 
          transformOrigin: 'left',
          width: '100%'
        }}
      />
    </div>
  );
}

export { Progress };