'use client';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { logger } from '@nexus/commons';
import BridgeAndExecuteModal from './bridge-execute-modal';
import { BridgeAndExecuteButtonProps } from '../../types';
import { trackError, trackWidgetInitiated } from 'src/utils/analytics';

export function BridgeAndExecuteButton({
  contractAddress,
  contractAbi,
  functionName,
  buildFunctionParams,
  prefill,
  children,
  className,
  title,
}: Readonly<BridgeAndExecuteButtonProps>) {
  const { startTransaction, activeTransaction } = useInternalNexus();

  const isLoading =
    activeTransaction?.status === 'processing' || activeTransaction?.reviewStatus === 'simulating';

  if (!contractAddress || !contractAbi || !functionName || !buildFunctionParams) {
    logger.warn('BridgeAndExecuteButton: Missing required contract props or builder');
    return null;
  }

  const handleClick = () => {
    try {
      trackWidgetInitiated('bridgeAndExecute');

      const transactionData = {
        ...(prefill || {}),
        contractAddress,
        contractAbi,
        functionName,
        buildFunctionParams,
      };

      startTransaction('bridgeAndExecute', transactionData);
    } catch (error) {
      trackError(error as Error, {
        function: 'bridgeAndExecute_button_click',
      });
      throw error;
    }
  };

  return (
    <>
      <div className={className}>
        {children({ onClick: handleClick, isLoading, disabled: false })}
      </div>
      <BridgeAndExecuteModal title={title} />
    </>
  );
}
