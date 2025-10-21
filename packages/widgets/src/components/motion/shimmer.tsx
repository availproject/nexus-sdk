import { cn } from '../../utils/utils';

export function Shimmer({ className }: Readonly<{ className?: string }>) {
  return <div className={cn('animate-pulse rounded-nexus-xl bg-gray-200', className)} />;
}
