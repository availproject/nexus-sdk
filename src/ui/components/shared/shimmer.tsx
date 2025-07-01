import React from 'react';
import { cn } from '../../utils/utils';

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}
