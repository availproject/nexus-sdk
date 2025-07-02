import React from 'react';
import { cn } from '../../utils/utils';

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-[16px] bg-[#EBEBF4]', className)} />;
}
