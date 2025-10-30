'use client';
import { FC } from 'react';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { SwapButtonProps } from '../../types';
import SwapModal from './swap-modal';
import { trackWidgetInitiated, trackError } from '../../utils/analytics';

export const SwapButton: FC<SwapButtonProps> = ({ prefill, children, className, title }) => {
  const { startTransaction, activeTransaction, config } = useInternalNexus();

  if (config?.network === 'testnet') {
    throw new Error('Testnet is not supported');
  }

  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    try {
      // Track widget initiation
      trackWidgetInitiated('swap');

      startTransaction('swap', prefill);
    } catch (error) {
      trackError(error as Error, {
        function: 'swap_button_click',
      });
      throw error;
    }
  };

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <SwapModal title={title} />
    </>
  );
};
