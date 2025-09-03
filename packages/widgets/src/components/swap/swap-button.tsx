'use client';
import { FC } from 'react';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { SwapButtonProps } from '../../types';
import SwapModal from './swap-modal';

export const SwapButton: FC<SwapButtonProps> = ({ prefill, children, className, title }) => {
  const { startTransaction, activeTransaction } = useInternalNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    startTransaction('swap', prefill);
  };

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <SwapModal title={title} />
    </>
  );
};
