import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { OrchestratorStatus, ReviewStatus } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getButtonText = (status: OrchestratorStatus, reviewStatus: ReviewStatus) => {
  if (status === 'initializing') return 'Sign';
  if (status === 'simulation_error') return 'Try Again';
  if (reviewStatus === 'gathering_input') return 'Start Transaction';
  if (reviewStatus === 'simulating') return 'Simulating...';
  if (reviewStatus === 'needs_allowance') return 'Approve and Continue';
  if (reviewStatus === 'ready') return 'Start Transaction';
  return 'Continue';
};

export const getOperationText = (type: string) => {
  switch (type) {
    case 'bridge':
      return 'Bridging';
    case 'transfer':
      return 'Transferring';
    case 'bridgeAndExecute':
      return 'Bridge & Execute';
    default:
      return 'Processing';
  }
};

export const getStatusText = (stepData: any, operationType: string) => {
  if (!stepData) return 'Verifying Request';

  const { type } = stepData;
  const opText = getOperationText(operationType);

  switch (type) {
    case 'INTENT_ACCEPTED':
      return 'Intent Accepted';
    case 'INTENT_HASH_SIGNED':
      return 'Signing Transaction';
    case 'INTENT_SUBMITTED':
      return 'Submitting Transaction';
    case 'INTENT_COLLECTION':
      return 'Collecting Confirmations';
    case 'INTENT_COLLECTION_COMPLETE':
      return 'Confirmations Complete';
    case 'INTENT_FULFILLED':
      return `${opText} Complete`;
    default:
      return `Processing ${opText}`;
  }
};
