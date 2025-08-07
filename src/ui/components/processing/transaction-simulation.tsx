import React from 'react';
import { SimulationResult, BridgeAndExecuteSimulationResult } from '../../../types';
import { InfoMessage } from '../shared/info-message';
import { TransactionDetailsDrawer } from '../shared/transaction-details-drawer';

interface TransactionSimulationProps {
  isLoading: boolean;
  simulationResult?: (SimulationResult | BridgeAndExecuteSimulationResult) & {
    allowance?: { needsApproval: boolean };
  };
  inputData?: {
    token?: string;
    amount?: string | number;
    chainId?: number;
    toChainId?: number;
  };
  callback: () => void;
}

export function TransactionSimulation({
  isLoading,
  simulationResult,
  inputData,
  callback,
}: TransactionSimulationProps) {
  if (isLoading) {
    return (
      <div className="flex items-start w-full py-6 px-4">
        <div className="text-sm text-zinc-500">Loading transaction details...</div>
      </div>
    );
  }

  if (!simulationResult) {
    return null;
  }

  return (
    <div className="flex flex-col gap-y-4 w-full items-start">
      {simulationResult?.allowance?.needsApproval && (
        <InfoMessage variant="warning" className="px-0">
          You need to set allowance in your wallet first to continue.
        </InfoMessage>
      )}

      <div className="flex justify-center py-2">
        <TransactionDetailsDrawer
          simulationResult={simulationResult}
          inputData={inputData}
          callback={callback}
          triggerClassname="px-4"
        />
      </div>
    </div>
  );
}
