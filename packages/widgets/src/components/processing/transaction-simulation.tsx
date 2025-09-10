import { type SimulationResult, type BridgeAndExecuteSimulationResult } from '@nexus/commons';
import { InfoMessage } from '../shared/info-message';
import { TransactionDetailsDrawer } from '../shared/transaction-details-drawer';
import TextLoader from '../motion/text-loader';
import {
  OrchestratorStatus,
  ReviewStatus,
  TransactionType,
  SwapSimulationResult,
} from '../../types';

interface TransactionSimulationProps {
  isLoading: boolean;
  simulationResult?: (
    | SimulationResult
    | BridgeAndExecuteSimulationResult
    | SwapSimulationResult
  ) & {
    allowance?: { needsApproval: boolean };
  };
  inputData?: {
    token?: string;
    amount?: string | number;
    chainId?: number;
    toChainId?: number;
  };
  type?: TransactionType;
  callback: () => void;
  status: OrchestratorStatus;
  reviewStatus: ReviewStatus;
}

export function TransactionSimulation({
  isLoading,
  simulationResult,
  inputData,
  type,
  callback,
  status,
  reviewStatus,
}: TransactionSimulationProps) {
  if (isLoading) {
    return (
      <div className="flex items-start w-full py-3 px-6">
        <TextLoader text="Loading transaction details..." />
      </div>
    );
  }

  if (!simulationResult) {
    return null;
  }

  return (
    <div className="flex flex-col gap-y-4 w-full items-start">
      {simulationResult?.allowance?.needsApproval && (
        <div className="flex items-center w-full justify-center px-6">
          <InfoMessage variant="warning" className="px-0 w-full">
            You need to set allowance in your wallet first to continue.
          </InfoMessage>
        </div>
      )}

      <div className="flex justify-center py-2">
        <TransactionDetailsDrawer
          simulationResult={simulationResult}
          inputData={inputData}
          callback={callback}
          triggerClassname="px-6"
          type={type}
          status={status}
          reviewStatus={reviewStatus}
        />
      </div>
    </div>
  );
}
