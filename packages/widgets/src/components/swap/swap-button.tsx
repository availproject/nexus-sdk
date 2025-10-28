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
      
      // Track intent creation with prefill data
      if (prefill) {
        const intentData = {
          intentType: 'swap' as const,
          sourceChain: prefill.fromChainID,
          targetChain: prefill.toChainID,
          token: prefill.fromTokenAddress,
          amount: prefill.fromAmount
        };
        
        // Import and call trackIntentCreated
        import('../../utils/analytics').then(({ trackIntentCreated }) => {
          trackIntentCreated(intentData);
        }).catch(err => {
          // Silently fail if analytics not initialized
          console.debug('Analytics not available:', err);
        });
      }
      
      startTransaction('swap', prefill);
    } catch (error) {
      trackError(error as Error, {
        function: 'swap_button_click'
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