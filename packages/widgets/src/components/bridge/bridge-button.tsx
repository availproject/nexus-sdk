'use client';
import type { BridgeButtonProps } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import BridgeModal from './bridge-modal';
import { trackWidgetInitiated, trackError } from '../../utils/analytics';

export function BridgeButton({ prefill, children, className, title }: Readonly<BridgeButtonProps>) {
  const { startTransaction, activeTransaction, config } = useInternalNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    try {
      // Track widget initiation
      trackWidgetInitiated(
        { network: config?.network ?? 'mainnet', debug: config?.debug ?? false },
        'bridge',
      );

      startTransaction('bridge', prefill);
    } catch (error) {
      trackError(
        error as Error,
        { network: config?.network ?? 'mainnet', debug: config?.debug ?? false },
        {
          function: 'bridge_button_click',
        },
      );
    }
  };

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <BridgeModal title={title} />
    </>
  );
}
