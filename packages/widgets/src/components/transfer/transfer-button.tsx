'use client';
import type { TransferButtonProps } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import TransferModal from './transfer-modal';

export function TransferButton({ prefill, children, className, title }: TransferButtonProps) {
  const { startTransaction, activeTransaction } = useInternalNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    startTransaction('transfer', prefill);
  };

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <TransferModal title={title} />
    </>
  );
}
