import { useEffect, useState, useCallback } from 'react';
import { NEXUS_EVENTS } from '../../constants';
import { getStatusText } from '../utils/utils';
import { NexusSDK } from '../../sdk';
import { ActiveTransaction } from '../types';
import { ProgressStep, ProgressSteps } from '@arcana/ca-sdk';

interface ProcessingStep {
  id: number;
  completed: boolean;
  progress: number; // 0-100
  stepData?: ProgressStep | ProgressSteps;
}

interface ProcessingState {
  currentStep: number;
  totalSteps: number;
  steps: ProcessingStep[];
  statusText: string;
  animationProgress: number;
}

const useListenTransaction = ({
  sdk,
  activeTransaction,
}: {
  sdk: NexusSDK;
  activeTransaction: ActiveTransaction;
}) => {
  const { type } = activeTransaction;
  const [processing, setProcessing] = useState<ProcessingState>(() => ({
    currentStep: 0,
    totalSteps: 3,
    steps: Array.from({ length: 3 }, (_, i) => ({
      id: i,
      completed: false,
      progress: 0,
    })),
    statusText: 'Verifying Request',
    animationProgress: 0,
  }));
  const [explorerURL, setExplorerURL] = useState<string | null>(null);

  const resetProcessingState = useCallback(() => {
    setProcessing({
      currentStep: 0,
      totalSteps: 3,
      steps: Array.from({ length: 3 }, (_, i) => ({
        id: i,
        completed: false,
        progress: 0,
      })),
      statusText: 'Verifying Request',
      animationProgress: 0,
    });
    setExplorerURL(null);
  }, []);

  useEffect(() => {
    if (!sdk) return;

    const handleExpectedSteps = (expectedSteps: ProgressSteps[]) => {
      const stepCount = Array.isArray(expectedSteps) ? expectedSteps.length : expectedSteps;
      const steps = Array.isArray(expectedSteps) ? expectedSteps : [];

      const newSteps = Array.from({ length: stepCount }, (_, i) => ({
        id: i,
        completed: false,
        progress: 0,
        stepData: steps[i] || null,
      }));

      setProcessing((prev: ProcessingState) => ({
        ...prev,
        totalSteps: stepCount,
        steps: newSteps,
        statusText: 'Verifying Request',
      }));
    };

    const handleStepComplete = (stepData: ProgressStep) => {
      const { type: stepType, typeID, data } = stepData;

      if (typeID === 'IS' && data && 'explorerURL' in data) {
        setExplorerURL(data?.explorerURL);
      }

      setProcessing((prev: ProcessingState) => {
        const typeIDMap: { [key: string]: number } = { IA: 0, IHS: 1, IS: 2 };
        const stepIndex = typeIDMap[typeID] ?? prev.currentStep;
        const newSteps = [...prev.steps];

        for (let i = 0; i <= stepIndex && i < newSteps.length; i++) {
          newSteps[i] = {
            ...newSteps[i],
            completed: true,
            progress: 100,
            stepData: i === stepIndex ? stepData : newSteps[i].stepData,
          };
        }

        const nextStep = Math.min(stepIndex + 1, prev.totalSteps);
        const animationProgress = ((stepIndex + 1) / prev.totalSteps) * 100;
        let description = getStatusText(stepData, type || 'bridge');
        if (stepType === 'INTENT_COLLECTION' && data) {
          description = `Collecting Confirmations`;
        }

        return {
          ...prev,
          currentStep: nextStep,
          steps: newSteps,
          animationProgress: Math.min(animationProgress, 100),
          statusText: description,
        };
      });
    };

    sdk.nexusEvents?.on(NEXUS_EVENTS.EXPECTED_STEPS, handleExpectedSteps);
    sdk.nexusEvents?.on(NEXUS_EVENTS.STEP_COMPLETE, handleStepComplete);

    return () => {
      sdk.nexusEvents?.off(NEXUS_EVENTS.EXPECTED_STEPS, handleExpectedSteps);
      sdk.nexusEvents?.off(NEXUS_EVENTS.STEP_COMPLETE, handleStepComplete);
    };
  }, [sdk, type]);

  useEffect(() => {
    if (!sdk) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (activeTransaction.status === 'processing') {
        e.preventDefault();
        e.returnValue = 'A transaction is currently in progress. Are you sure you want to leave?';
      }
      return 'A transaction is currently in progress. Are you sure you want to leave?';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [activeTransaction.status]);

  return { processing, explorerURL, resetProcessingState };
};

export default useListenTransaction;
