import React from 'react';
import type { TransferButtonProps } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import TransferModal from './transfer-modal';

export function TransferButton({ prefill, children, className }: TransferButtonProps) {
  const { startTransaction, activeTransaction } = useInternalNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    startTransaction('transfer', prefill);
  };

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <TransferModal />
    </>
  );
}
