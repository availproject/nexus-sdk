'use client';
import type { TransferButtonProps } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import TransferModal from './transfer-modal';
import { trackError, trackWidgetInitiated } from 'src/utils/analytics';

export function TransferButton({
  prefill,
  children,
  className,
  title,
}: Readonly<TransferButtonProps>) {
  const { startTransaction, activeTransaction, config } = useInternalNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    try {
      // Track widget initiation
      trackWidgetInitiated(
        { network: config?.network ?? 'mainnet', debug: config?.debug ?? false },
        'transfer',
      );

      startTransaction('transfer', prefill);
    } catch (error) {
      trackError(
        error as Error,
        { network: config?.network ?? 'mainnet', debug: config?.debug ?? false },
        {
          function: 'transfer_button_click',
        },
      );
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
