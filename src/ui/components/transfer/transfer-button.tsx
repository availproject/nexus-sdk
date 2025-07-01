import React from 'react';
import type { TransferButtonProps } from '../../types';
import { useNexus } from '../../providers/NexusProvider';
import { TransferModal } from './transfer-modal';

export function TransferButton({
  prefill,
  onSuccess,
  onError,
  children,
  className,
}: TransferButtonProps) {
  const { startTransaction, activeTransaction } = useNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    startTransaction('transfer', prefill);
  };

  // TODO: Refactor onSuccess and onError to be handled by the orchestrator
  // For now, we can leave them be, but they will likely be deprecated.

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <TransferModal />
    </>
  );
}
