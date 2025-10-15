import { useEffect, useState, useCallback } from 'react';
import { NEXUS_EVENTS } from '@nexus/commons';
import { getStatusText } from '../utils/utils';
import { NexusSDK } from '@avail-project/nexus-core';
import { ActiveTransaction } from '../types';
import { ProgressStep, ProgressSteps, SwapStep } from '@avail-project/nexus-core';

// Swap-specific step handling
export const getTextFromSwapStep = (step: SwapStep): string => {
  switch (step.type) {
    case 'CREATE_PERMIT_EOA_TO_EPHEMERAL':
      return `Creating permit for eoa to ephemeral for ${step.symbol} on ${step.chain?.name || 'chain'}`;
    case 'CREATE_PERMIT_FOR_SOURCE_SWAP':
      return `Creating permit for source swap for ${step.symbol} on ${step.chain?.name || 'chain'}`;
    case 'DESTINATION_SWAP_BATCH_TX':
      return `Creating destination swap transaction`;
    case 'DESTINATION_SWAP_HASH':
      return `Hash for destination swap on ${step.chain?.name || 'chain'}`;
    case 'DETERMINING_SWAP':
      return `Generating routes for XCS`;
    case 'RFF_ID':
      return `Chain abstracted intent`;
    case 'SOURCE_SWAP_BATCH_TX':
      return 'Creating source swap batch transactions';
    case 'SOURCE_SWAP_HASH':
      return `Hash for source swap on ${step.chain?.name || 'chain'}`;
    case 'SWAP_COMPLETE':
      return `Swap is completed`;
    case 'SWAP_START':
      return 'Swap starting';
    default:
      return 'Processing swap';
  }
};

const swapSteps = [
  { id: 0, type: 'SWAP_START', typeID: 'SWAP_START', name: 'Starting Swap' },
  { id: 1, type: 'DETERMINING_SWAP', typeID: 'DETERMINING_SWAP', name: 'Finding Best Route' },
  {
    id: 2,
    type: 'SOURCE_SWAP_BATCH_TX',
    typeID: 'SOURCE_SWAP_BATCH_TX',
    name: 'Source Transaction',
  },
  { id: 3, type: 'SOURCE_SWAP_HASH', typeID: 'SOURCE_SWAP_HASH', name: 'Source Transaction hash' },
  { id: 4, type: 'RFF_ID', typeID: 'RFF_ID', name: 'Source Transaction hash' },
  {
    id: 5,
    type: 'DESTINATION_SWAP_BATCH_TX',
    typeID: 'DESTINATION_SWAP_BATCH_TX',
    name: 'Destination Transaction',
  },
  {
    id: 6,
    type: 'DESTINATION_SWAP_HASH',
    typeID: 'DESTINATION_SWAP_HASH',
    name: 'Destination Transaction hash',
  },
  {
    id: 7,
    type: 'CREATE_PERMIT_FOR_SOURCE_SWAP',
    typeID: 'CREATE_PERMIT_FOR_SOURCE_SWAP',
    name: 'Permit',
  },

  {
    id: 8,
    type: 'CREATE_PERMIT_EOA_TO_EPHEMERAL',
    typeID: 'CREATE_PERMIT_EOA_TO_EPHEMERAL',
    name: 'Permit Ephemeral',
  },
  { id: 9, type: 'SWAP_COMPLETE', typeID: 'SWAP_COMPLETE', name: 'Swap Complete' },
];

interface ProcessingStep {
  id: number;
  completed: boolean;
  progress: number; // 0-100
  stepData?: ProgressStep | ProgressSteps | SwapStep;
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
  const [explorerURLs, setExplorerURLs] = useState<{ source?: string; destination?: string }>({});

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
    setExplorerURLs({});
  }, []);

  useEffect(() => {
    if (!sdk) return;

    // Special handling for swap transactions
    if (type === 'swap') {
      // For swap, we create our own progress steps since no expected_steps are emitted

      const initialSteps = swapSteps.map((step, index) => ({
        id: index,
        completed: false,
        progress: 0,
        stepData: step as any, // Step structure for swap mock data
      }));

      setProcessing({
        currentStep: 0,
        totalSteps: swapSteps.length,
        steps: initialSteps,
        statusText: 'Preparing Swap',
        animationProgress: 0,
      });

      const handleSwapStepComplete = (stepData: SwapStep) => {
        setProcessing((prev) => {
          // Find matching step by type
          const stepIndex = swapSteps.findIndex((s) => s.typeID === stepData.type);

          if (stepIndex === -1) {
            // Unknown step, just advance progress
            const nextStep = Math.min(prev.currentStep + 1, prev.totalSteps);
            return {
              ...prev,
              currentStep: nextStep,
              animationProgress: (nextStep / prev.totalSteps) * 100,
              statusText: getTextFromSwapStep(stepData),
            };
          }

          const newSteps = [...prev.steps];

          // Mark all steps up to and including current as completed
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

          return {
            ...prev,
            currentStep: nextStep,
            steps: newSteps,
            animationProgress: Math.min(animationProgress, 100),
            statusText: getTextFromSwapStep(stepData),
          };
        });

        // Handle explorer URL extraction for swap
        if (stepData.type === 'SOURCE_SWAP_HASH' && 'explorerURL' in stepData) {
          setExplorerURLs((prev) => ({ ...prev, source: stepData.explorerURL }));
          setExplorerURL(stepData.explorerURL); // Keep for backward compatibility
        } else if (stepData.type === 'DESTINATION_SWAP_HASH' && 'explorerURL' in stepData) {
          setExplorerURLs((prev) => ({ ...prev, destination: stepData.explorerURL }));
          setExplorerURL(stepData.explorerURL); // Update to show latest
        }
      };

      sdk?.nexusEvents?.on(NEXUS_EVENTS.SWAP_STEPS, handleSwapStepComplete);

      return () => {
        sdk.nexusEvents?.off(NEXUS_EVENTS.SWAP_STEPS, handleSwapStepComplete);
      };
    }

    // Regular handling for non-swap transactions
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

  return { processing, explorerURL, explorerURLs, resetProcessingState };
};

export default useListenTransaction;
