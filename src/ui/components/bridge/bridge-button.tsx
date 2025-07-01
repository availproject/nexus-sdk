import React from 'react';
import type { BridgeButtonProps } from '../../types';
import { useNexus } from '../../providers/NexusProvider';
import { BridgeModal } from './bridge-modal';

export function BridgeButton({
  prefill,
  onSuccess,
  onError,
  children,
  className,
}: BridgeButtonProps) {
  const { startTransaction, activeTransaction } = useNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    startTransaction('bridge', prefill);
  };

  // TODO: Refactor onSuccess and onError to be handled by the orchestrator
  // For now, we can leave them be, but they will likely be deprecated.

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <BridgeModal />
    </>
  );
}
