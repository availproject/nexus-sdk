'use client';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { logger } from '@nexus/commons';
import BridgeAndExecuteModal from './bridge-execute-modal';
import { BridgeAndExecuteButtonProps } from '../../types';

export function BridgeAndExecuteButton({
  contractAddress,
  contractAbi,
  functionName,
  buildFunctionParams,
  prefill,
  children,
  className,
  title,
}: BridgeAndExecuteButtonProps) {
  const { startTransaction, activeTransaction } = useInternalNexus();

  const isLoading =
    activeTransaction?.status === 'processing' || activeTransaction?.reviewStatus === 'simulating';

  if (!contractAddress || !contractAbi || !functionName || !buildFunctionParams) {
    logger.warn('BridgeAndExecuteButton: Missing required contract props or builder');
    return null;
  }

  const handleClick = () => {
    const transactionData = {
      ...(prefill || {}),
      contractAddress,
      contractAbi,
      functionName,
      buildFunctionParams,
    };

    startTransaction('bridgeAndExecute', transactionData);
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
