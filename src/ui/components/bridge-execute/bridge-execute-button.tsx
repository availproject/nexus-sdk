'use client';
import React from 'react';
import type { BridgeAndExecuteButtonProps } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { logger } from '../../../core/utils';
import BridgeAndExecuteModal from './bridge-execute-modal';

export function BridgeAndExecuteButton({
  contractAddress,
  contractAbi,
  functionName,
  buildFunctionParams,
  prefill,
  children,
  className,
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
      <BridgeAndExecuteModal />
    </>
  );
}
