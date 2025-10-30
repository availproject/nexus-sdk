'use client';
import type { TransferButtonProps } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import TransferModal from './transfer-modal';
import { trackError, trackIntentCreated, trackWidgetInitiated } from 'src/utils/analytics';

export function TransferButton({
  prefill,
  children,
  className,
  title,
}: Readonly<TransferButtonProps>) {
  const { startTransaction, activeTransaction } = useInternalNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    try {
      // Track widget initiation
      trackWidgetInitiated('transfer');

      // Track intent creation with prefill data
      if (prefill) {
        const intentData = {
          intentType: 'transfer' as const,
          sourceChain: prefill.sourceChains,
          targetChain: prefill.chainId,
          token: prefill.token,
          amount: prefill.amount,
        };
        trackIntentCreated(intentData);
      }

      startTransaction('transfer', prefill);
    } catch (error) {
      trackError(error as Error, {
        function: 'transfer_button_click',
      });
      throw error;
    }
  };

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <TransferModal title={title} />
    </>
  );
}
