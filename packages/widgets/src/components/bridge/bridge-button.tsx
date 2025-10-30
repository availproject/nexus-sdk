'use client';
import type { BridgeButtonProps } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import BridgeModal from './bridge-modal';
import { trackWidgetInitiated, trackError, trackIntentCreated } from '../../utils/analytics';

export function BridgeButton({ prefill, children, className, title }: Readonly<BridgeButtonProps>) {
  const { startTransaction, activeTransaction } = useInternalNexus();
  const isLoading =
    activeTransaction.status === 'processing' || activeTransaction.reviewStatus === 'simulating';

  const handleClick = () => {
    try {
      // Track widget initiation
      trackWidgetInitiated('bridge');

      // Track intent creation with prefill data
      if (prefill) {
        const intentData = {
          intentType: 'bridge' as const,
          sourceChain: prefill.sourceChains,
          targetChain: prefill.chainId, // ✅ Fixed: was prefill.toChainId
          token: prefill.token,
          amount: prefill.amount,
        };

        trackIntentCreated(intentData);
      }

      startTransaction('bridge', prefill);
    } catch (error) {
      trackError(error as Error, {
        function: 'bridge_button_click',
      });
      throw error;
    }
  };

  return (
    <>
      <div className={className}>{children({ onClick: handleClick, isLoading })}</div>
      <BridgeModal title={title} />
    </>
  );
}
