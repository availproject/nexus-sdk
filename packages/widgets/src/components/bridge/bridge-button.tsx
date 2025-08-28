'use client';
import type { BridgeButtonProps } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import BridgeModal from './bridge-modal';

export function BridgeButton({ prefill, children, className, title }: BridgeButtonProps) {
  const { startTransaction, activeTransaction } = useInternalNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    startTransaction('bridge', prefill);
  };

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <BridgeModal title={title} />
    </>
  );
}
