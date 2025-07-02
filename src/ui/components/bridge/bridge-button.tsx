import React from 'react';
import type { BridgeButtonProps } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { BridgeModal } from './bridge-modal';

export function BridgeButton({ prefill, children, className }: BridgeButtonProps) {
  const { startTransaction, activeTransaction } = useInternalNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    startTransaction('bridge', prefill);
  };

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <BridgeModal />
    </>
  );
}
