import { useEffect, useState, useCallback } from 'react';
import { NEXUS_EVENTS } from '../../constants';
import { getStatusText } from '../utils/utils';
import { NexusSDK } from '../../core/sdk';
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
  const DEFAULT_INITIAL_STEPS = 10;

  const [processing, setProcessing] = useState<ProcessingState>(() => ({
    currentStep: 0,
    totalSteps: DEFAULT_INITIAL_STEPS,
    steps: Array.from({ length: DEFAULT_INITIAL_STEPS }, (_, i) => ({
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
      totalSteps: DEFAULT_INITIAL_STEPS,
      steps: Array.from({ length: DEFAULT_INITIAL_STEPS }, (_, i) => ({
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

    // Flag to know when we have received the complete expected-steps list
    let expectedReceived = false;
    // Queue to store stepComplete events that arrive before expected steps
    const pendingSteps: ProgressStep[] = [];
    const expectedEventType =
      type === 'bridgeAndExecute'
        ? NEXUS_EVENTS.BRIDGE_EXECUTE_EXPECTED_STEPS
        : NEXUS_EVENTS.EXPECTED_STEPS;

    const completedEventType =
      type === 'bridgeAndExecute'
        ? NEXUS_EVENTS.BRIDGE_EXECUTE_COMPLETED_STEPS
        : NEXUS_EVENTS.STEP_COMPLETE;

    const handleExpectedSteps = (expectedSteps: ProgressSteps[]) => {
      expectedReceived = true;
      console.log('expectedSteps', expectedSteps);
      const stepCount = Array.isArray(expectedSteps) ? expectedSteps.length : expectedSteps;
      const steps = Array.isArray(expectedSteps) ? expectedSteps : [];

      // Build initial step objects from expected steps array
      const initialSteps = Array.from({ length: stepCount }, (_, i) => ({
        id: i,
        completed: false,
        progress: 0,
        stepData: steps[i] || null,
      }));

      // Preserve any steps that were already completed before this event arrived
      setProcessing((prev: ProcessingState) => {
        const completedTypeIDs = prev.steps
          .filter((s) => s.completed)
          .map((s) => (s.stepData as ProgressStep)?.typeID) as string[];

        const mergedSteps = initialSteps.map((step) => {
          const typeID = (step.stepData as any)?.typeID as string | undefined;
          if (typeID && completedTypeIDs.includes(typeID)) {
            return { ...step, completed: true, progress: 100 };
          }
          return step;
        });

        const completedCount = mergedSteps.filter((s) => s.completed).length;

        let newState: ProcessingState = {
          ...prev,
          totalSteps: stepCount,
          steps: mergedSteps,
          currentStep: completedCount,
          animationProgress: (completedCount / stepCount) * 100,
          statusText: 'Verifying Request',
        };

        // Now process any queued steps that arrived before expected steps
        if (pendingSteps.length > 0) {
          pendingSteps.forEach((queuedStep) => {
            newState = processStep(newState, queuedStep);
          });
          pendingSteps.length = 0; // clear queue
        }

        return newState;
      });
    };

    // Helper to process a single step and return updated state (pure function)
    const processStep = (prev: ProcessingState, stepData: ProgressStep): ProcessingState => {
      const { type: stepType, typeID, data } = stepData;

      let stepIndex = prev.steps.findIndex((s) => {
        const id = (s.stepData as any)?.typeID as string | undefined;
        return id === typeID;
      });

      if (stepIndex === -1) {
        stepIndex = Math.min(prev.currentStep, prev.totalSteps - 1);
      }

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
        description = 'Collecting Confirmations';
      }

      return {
        ...prev,
        currentStep: nextStep,
        steps: newSteps,
        animationProgress: Math.min(animationProgress, 100),
        statusText: description,
      };
    };

    const handleStepComplete = (stepData: ProgressStep) => {
      console.log('stepData', stepData);
      const { typeID, data } = stepData;

      // Always advance progress for better UX
      setProcessing((prev) => processStep(prev, stepData));

      // Queue until we have real mapping
      if (!expectedReceived) {
        pendingSteps.push(stepData);
      }

      if (typeID === 'IS' && data && 'explorerURL' in data) {
        setExplorerURL((data as any)?.explorerURL as string);
      }
    };

    sdk?.nexusEvents?.on(expectedEventType, handleExpectedSteps);
    sdk?.nexusEvents?.on(completedEventType, handleStepComplete);

    return () => {
      sdk.nexusEvents?.off(expectedEventType, handleExpectedSteps);
      sdk.nexusEvents?.off(completedEventType, handleStepComplete);
    };
  }, [sdk, type]);

  useEffect(() => {
    if (!sdk) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (
        activeTransaction.status === 'processing' ||
        activeTransaction.status === 'set_allowance'
      ) {
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
