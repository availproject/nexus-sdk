import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { useDragConstraints } from '../shared';
import { ProcessorMiniCard } from './processor-mini-card';
import { ProcessorFullCard } from './processor-full-card';
import { BridgeAndExecuteSimulationResult, SimulationResult } from '../../../types';
import { CHAIN_METADATA, TOKEN_METADATA } from '../../../constants';
import { getOperationText } from '../../utils/utils';
import { TransactionType } from '../../types';

export const TransactionProcessorShell: React.FC = () => {
  const {
    activeTransaction,
    processing,
    explorerURL,
    timer,
    toggleTransactionCollapse,
    isTransactionCollapsed,
    cancelTransaction,
  } = useInternalNexus();

  const { type: transactionType, simulationResult } = activeTransaction;

  const sources = useMemo(() => {
    if (!simulationResult) return [] as number[];
    if (transactionType === 'bridge' || transactionType === 'transfer') {
      return (simulationResult as SimulationResult)?.intent?.sources?.map((s) => s.chainID) || [];
    }

    const bridgeExecuteResult = simulationResult as BridgeAndExecuteSimulationResult;

    // If bridge was skipped, use the target chain as the source since we're executing directly
    if (bridgeExecuteResult?.metadata?.bridgeSkipped) {
      return [bridgeExecuteResult.metadata.targetChain];
    }

    return bridgeExecuteResult.bridgeSimulation?.intent?.sources?.map((s) => s.chainID) || [];
  }, [simulationResult, transactionType]);

  const destination = useMemo(() => {
    if (!simulationResult) return 0;
    if (transactionType === 'bridge' || transactionType === 'transfer') {
      return (simulationResult as SimulationResult)?.intent?.destination?.chainID || 0;
    }

    const bridgeExecuteResult = simulationResult as BridgeAndExecuteSimulationResult;

    // If bridge was skipped, use the target chain as the destination
    if (bridgeExecuteResult?.metadata?.bridgeSkipped) {
      return bridgeExecuteResult.metadata.targetChain;
    }

    return bridgeExecuteResult.bridgeSimulation?.intent?.destination?.chainID || 0;
  }, [simulationResult, transactionType]);

  const token = activeTransaction.inputData?.token || '';

  const sourceChainMeta = sources
    .filter((s): s is number => s != null && !isNaN(s))
    .map((s) => CHAIN_METADATA[s as keyof typeof CHAIN_METADATA])
    .filter(Boolean);

  const destChainMeta = destination
    ? CHAIN_METADATA[destination as keyof typeof CHAIN_METADATA]
    : null;
  const tokenMeta = token ? TOKEN_METADATA[token as keyof typeof TOKEN_METADATA] : null;

  const getDescription = () => {
    if (activeTransaction?.executionResult?.success) return 'Transaction Completed Successfully';
    return `${getOperationText(transactionType as TransactionType)} ${tokenMeta?.symbol || 'token'} from ${sourceChainMeta.length > 1 ? 'multiple chains' : sourceChainMeta[0]?.name} to ${destChainMeta?.name || 'destination chain'}`;
  };

  const shellActive = ['processing', 'success', 'error'].includes(activeTransaction.status);

  const dragConstraints = useDragConstraints();

  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const update = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const COLLAPSED = { width: 400, height: 120, radius: 16 } as const;
  const EXPANDED = { width: 480, height: 600, radius: 16 } as const;

  const collapsedPos = {
    x: Math.max(16, windowSize.width - COLLAPSED.width - 16),
    y: 16,
  };

  const expandedPos = {
    x: Math.max(0, (windowSize.width - EXPANDED.width) / 2),
    y: Math.max(0, (windowSize.height - EXPANDED.height) / 2),
  };

  if (!shellActive || !transactionType || !simulationResult) {
    return null;
  }

  return (
    <AnimatePresence>
      <>
        {/* Backdrop */}
        {!isTransactionCollapsed && (
          <motion.div
            key="tx-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 bg-nexus-backdrop backdrop-blur-[4px] z-40"
          />
        )}

        {/* Processor Card */}
        <motion.div
          key="tx-card"
          drag={isTransactionCollapsed}
          dragConstraints={dragConstraints}
          dragElastic={0.05}
          dragMomentum={false}
          whileDrag={{
            scale: 0.95,
            rotate: 2,
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)',
            zIndex: 60,
          }}
          initial={false}
          animate={{
            width: isTransactionCollapsed ? COLLAPSED?.width : EXPANDED?.width,
            height: isTransactionCollapsed ? COLLAPSED?.height : EXPANDED?.height,
            x: isTransactionCollapsed ? collapsedPos?.x : expandedPos?.x,
            y: isTransactionCollapsed ? collapsedPos?.y : expandedPos?.y,
            borderRadius: isTransactionCollapsed ? COLLAPSED?.radius : EXPANDED?.radius,
            boxShadow: isTransactionCollapsed
              ? '0 10px 25px -5px rgba(0,0,0,0.2)'
              : '0 25px 50px -12px rgba(0,0,0,0.25)',
            opacity: 1,
          }}
          exit={{ opacity: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 320, mass: 0.6 }}
          className={`fixed top-0 left-0 bg-white font-nexus-primary overflow-hidden z-50 pointer-events-auto rounded-nexus-xl ${
            isTransactionCollapsed
              ? 'cursor-move px-4 py-2 border border-gray-200'
              : 'shadow-card  flex flex-col items-center justify-between w-full'
          }`}
        >
          {isTransactionCollapsed ? (
            <ProcessorMiniCard
              status={activeTransaction?.status}
              cancelTransaction={cancelTransaction}
              toggleTransactionCollapse={toggleTransactionCollapse}
              sourceChainMeta={sourceChainMeta}
              destChainMeta={destChainMeta}
              tokenMeta={tokenMeta}
              transactionType={transactionType}
              simulationResult={simulationResult}
              processing={processing}
              explorerURL={explorerURL}
              timer={timer}
              description={getDescription()}
              error={activeTransaction?.error}
              executionResult={activeTransaction?.executionResult}
            />
          ) : (
            <ProcessorFullCard
              status={activeTransaction?.status}
              cancelTransaction={cancelTransaction}
              toggleTransactionCollapse={toggleTransactionCollapse}
              sourceChainMeta={sourceChainMeta}
              destChainMeta={destChainMeta}
              tokenMeta={tokenMeta}
              transactionType={transactionType}
              simulationResult={simulationResult}
              processing={processing}
              explorerURL={explorerURL}
              timer={timer}
              description={getDescription()}
              error={activeTransaction?.error}
              executionResult={activeTransaction?.executionResult}
            />
          )}
        </motion.div>
      </>
    </AnimatePresence>
  );
};
