import React, { useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import SuccessRipple from '../motion/success-ripple';
import { WordsPullUp } from '../motion/pull-up-words';
import {
  type BridgeAndExecuteResult,
  type BridgeAndExecuteSimulationResult,
  type SimulationResult,
  SUPPORTED_CHAINS,
  TOKEN_METADATA,
} from '@nexus/commons';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { SmallAvailLogo } from '../icons/SmallAvailLogo';
import type { DotLottie, DotLottieWorker } from '@lottiefiles/dotlottie-react';
import { CircleX, ExternalLink, Minimize } from '../icons';
import { cn, formatCost } from '../../utils/utils';
import { Button } from '../motion/button-motion';
import { ThreeStageProgress } from '../motion/three-stage-progress';
import { EnhancedInfoMessage } from '../shared/enhanced-info-message';
import { ProcessorCardProps, SwapSimulationResult } from '../../types';
import { TokenIcon } from '../shared/icons';

export const ProcessorFullCard: React.FC<ProcessorCardProps> = ({
  status,
  cancelTransaction,
  toggleTransactionCollapse,
  sourceChainMeta,
  destChainMeta,
  tokenMeta,
  transactionType,
  simulationResult,
  processing,
  explorerURL,
  explorerURLs,
  timer,
  description,
  error,
  executionResult,
  disableCollapse,
}: ProcessorCardProps) => {
  const lottieRef = useRef<DotLottie | DotLottieWorker | null>(null);

  // Render token icon (swap-only crossfade from source to destination)
  const renderTokenIcon = useCallback(() => {
    const progress = processing?.animationProgress ?? 0;

    // Non-swap: keep existing single token icon
    if (transactionType !== 'swap') {
      return (
        <div className="w-10 h-10 bg-white rounded-nexus-full border-2 border-gray-200 flex items-center justify-center shadow-md">
          <TokenIcon
            tokenSymbol={tokenMeta?.symbol || 'T'}
            iconUrl={tokenMeta?.icon}
            className="w-8 h-8 rounded-nexus-full"
          />
        </div>
      );
    }

    // Swap: crossfade from source token to destination token around 50%
    const swapResult = simulationResult as SwapSimulationResult;
    const destSymbol = swapResult?.intent?.destination?.token?.symbol?.toUpperCase();
    const destIcon = destSymbol ? TOKEN_METADATA[destSymbol]?.icon : undefined;
    const sourceIcon = tokenMeta?.icon;

    return (
      <div className="w-10 h-10 bg-white rounded-nexus-full border-2 border-gray-200 flex items-center justify-center shadow-md relative overflow-hidden">
        {/* Source token */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ opacity: progress < 50 ? 1 : 0, scale: progress < 50 ? 1 : 0.95 }}
          transition={{ duration: 0.25 }}
        >
          <TokenIcon
            tokenSymbol={tokenMeta?.symbol || 'T'}
            iconUrl={sourceIcon}
            className="w-8 h-8 rounded-nexus-full"
          />
        </motion.div>
        {/* Destination token */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ opacity: progress >= 50 ? 1 : 0, scale: progress >= 50 ? 1 : 1.05 }}
          transition={{ duration: 0.25 }}
        >
          <TokenIcon
            tokenSymbol={destSymbol || 'T'}
            iconUrl={destIcon}
            className="w-8 h-8 rounded-nexus-full"
          />
        </motion.div>
      </div>
    );
  }, [
    processing?.animationProgress,
    tokenMeta?.icon,
    tokenMeta?.symbol,
    transactionType,
    simulationResult,
  ]);

  const sourceAmount = useCallback(() => {
    if (transactionType === 'bridge' || transactionType === 'transfer') {
      return formatCost((simulationResult as SimulationResult)?.intent?.sourcesTotal);
    } else if (transactionType === 'swap') {
      const swapResult = simulationResult as SwapSimulationResult;
      return formatCost(swapResult?.intent?.sources?.[0]?.amount ?? '0');
    } else {
      const bridgeExecuteResult = simulationResult as BridgeAndExecuteSimulationResult;

      // If bridge was skipped, use input amount from metadata
      if (bridgeExecuteResult?.metadata?.bridgeSkipped) {
        return formatCost(bridgeExecuteResult.metadata.inputAmount ?? '');
      }

      return formatCost(bridgeExecuteResult?.bridgeSimulation?.intent?.sourcesTotal ?? '');
    }
  }, [transactionType, simulationResult]);

  const destinationAmount = useCallback(() => {
    if (transactionType === 'bridge' || transactionType === 'transfer') {
      return formatCost((simulationResult as SimulationResult)?.intent?.destination?.amount);
    } else if (transactionType === 'swap') {
      const swapResult = simulationResult as SwapSimulationResult;
      return formatCost(swapResult?.intent?.destination?.amount ?? '0');
    } else {
      const bridgeExecuteResult = simulationResult as BridgeAndExecuteSimulationResult;

      // If bridge was skipped, use input amount from metadata (same as source since no bridge)
      if (bridgeExecuteResult?.metadata?.bridgeSkipped) {
        return formatCost(bridgeExecuteResult.metadata.inputAmount ?? '');
      }

      return formatCost(bridgeExecuteResult?.bridgeSimulation?.intent?.destination?.amount ?? '');
    }
  }, [transactionType, simulationResult]);

  // Avoid nested ternaries by isolating explorer links rendering
  const renderExplorerLinks = useCallback((): React.ReactNode => {
    if (transactionType === 'bridgeAndExecute') {
      return (
        <div className="flex flex-col items-center gap-y-1">
          {/* Only show bridge transaction link if bridge wasn't skipped */}
          {explorerURL && !(executionResult as BridgeAndExecuteResult)?.bridgeSkipped && (
            <Button
              variant="link"
              className="text-nexus-accent underline text-base font-semibold font-nexus-primary cursor-pointer"
              onClick={() => window.open(explorerURL, '_blank')}
            >
              View Bridge Transaction{' '}
              <ExternalLink className="w-6 h-6 ml-2 text-nexus-muted-secondary" />
            </Button>
          )}
          {(executionResult as BridgeAndExecuteResult)?.executeExplorerUrl && (
            <Button
              variant="link"
              className=" text-nexus-accent underline text-base font-semibold font-nexus-primary cursor-pointer"
              onClick={() =>
                window.open(
                  (executionResult as BridgeAndExecuteResult)?.executeExplorerUrl,
                  '_blank',
                )
              }
            >
              {(executionResult as BridgeAndExecuteResult)?.bridgeSkipped
                ? 'View Transaction'
                : 'View Execute Transaction'}{' '}
              <ExternalLink className="w-6 h-6 ml-2 text-nexus-muted-secondary" />
            </Button>
          )}
        </div>
      );
    }

    if (transactionType === 'swap') {
      return (
        <div className="flex flex-col items-center gap-y-1">
          {explorerURLs?.source && (
            <Button
              variant="link"
              className="text-nexus-accent underline text-base font-semibold font-nexus-primary cursor-pointer p-0"
              onClick={() => window.open(explorerURLs.source, '_blank')}
            >
              View Source Transaction{' '}
              <ExternalLink className="w-6 h-6 ml-2 text-nexus-muted-secondary" />
            </Button>
          )}
          {explorerURLs?.destination && (
            <Button
              variant="link"
              className="text-nexus-accent underline text-base font-semibold font-nexus-primary cursor-pointer p-0"
              onClick={() => window.open(explorerURLs.destination, '_blank')}
            >
              View Destination Transaction{' '}
              <ExternalLink className="w-6 h-6 ml-2 text-nexus-muted-secondary" />
            </Button>
          )}
        </div>
      );
    }

    if (explorerURL) {
      return (
        <Button
          variant="link"
          className=" text-nexus-accent underline text-base font-semibold font-nexus-primary cursor-pointer"
          onClick={() => window.open(explorerURL, '_blank')}
        >
          View on Explorer <ExternalLink className="w-6 h-6 ml-2 text-nexus-muted-secondary" />
        </Button>
      );
    }

    return null;
  }, [transactionType, explorerURL, explorerURLs, executionResult]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={{ duration: 0.3 }}
        className="w-full h-full flex flex-col items-center"
      >
        <motion.div
          layout={false}
          onLayoutAnimationComplete={() => {
            lottieRef.current?.resize();
          }}
          className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none"
        >
          <div className="w-[380px] h-[380px] opacity-20">
            <DotLottieReact
              src="https://lottie.host/17486479-f319-4b3c-8c10-7bf10fcc534b/gRY7aNOi5G.lottie"
              loop
              autoplay={status === 'processing'}
              className="w-full h-full object-cover opacity-10 !mix-blend-screen"
              dotLottieRefCallback={(instance: DotLottie | DotLottieWorker | null) => {
                lottieRef.current = instance;
              }}
            />
          </div>
        </motion.div>
        <Button
          variant="link"
          size="icon"
          className="w-full flex items-end justify-end text-nexus-foreground mt-3 px-6 py-0"
          onClick={() => {
            if (status === 'error' || status === 'success') {
              cancelTransaction();
            } else {
              disableCollapse ? cancelTransaction() : toggleTransactionCollapse();
            }
          }}
        >
          {status === 'error' || status === 'success' || disableCollapse ? (
            <CircleX className="w-6 h-6 text-nexus-foreground" />
          ) : (
            <Minimize className="w-6 h-6 text-nexus-foreground" />
          )}
        </Button>
        <div className="w-full p-4 relative z-10">
          <div className="w-full flex flex-col items-center gap-y-6">
            {/* Chains Row */}
            <motion.div
              className="w-full flex items-center"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
            >
              {/* Sources */}
              <div className="flex flex-col items-center gap-y-2">
                <div className="flex items-center">
                  {Array.isArray(sourceChainMeta) &&
                    sourceChainMeta
                      .slice(0, 3)
                      .map((chain, index) => (
                        <img
                          key={chain?.id}
                          src={chain?.logo ?? ''}
                          alt={chain?.name ?? ''}
                          className={cn(
                            'w-12 h-12',
                            index > 0 ? '-ml-5' : '',
                            chain?.id !== SUPPORTED_CHAINS.BASE &&
                              chain?.id !== SUPPORTED_CHAINS.BASE_SEPOLIA
                              ? 'rounded-nexus-full'
                              : '',
                          )}
                          style={{ zIndex: (sourceChainMeta?.length || 0) - index }}
                        />
                      ))}
                </div>
                <div className="flex flex-col gap-y-1 items-center">
                  <p className="text-lg font-nexus-primary text-nexus-black font-bold">
                    {sourceAmount()}
                  </p>
                  <p className="text-sm font-nexus-primary text-nexus-muted-secondary font-medium">
                    From {sourceChainMeta?.length ?? 0} chain
                    {(sourceChainMeta?.length ?? 0) > 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              {/* Progress */}
              <motion.div
                className="flex-1 flex flex-col items-center justify-center px-2 relative"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              >
                <div className="relative w-full flex items-center justify-center">
                  <div className="w-full max-w-[300px] relative">
                    <ThreeStageProgress
                      progress={processing?.animationProgress}
                      hasError={!!error}
                      errorProgress={processing?.animationProgress}
                      tokenIcon={renderTokenIcon()}
                      size="lg"
                    />
                  </div>
                </div>
              </motion.div>
              {/* Destination */}
              <div className="flex flex-col items-center gap-y-2 relative">
                {destChainMeta ? (
                  <>
                    <SuccessRipple size="md">
                      <img
                        src={destChainMeta?.logo ?? ''}
                        alt={destChainMeta?.name ?? ''}
                        className={cn(
                          'w-12 h-12',
                          destChainMeta?.id !== SUPPORTED_CHAINS.BASE &&
                            destChainMeta?.id !== SUPPORTED_CHAINS.BASE_SEPOLIA
                            ? 'rounded-nexus-full'
                            : '',
                        )}
                      />
                    </SuccessRipple>
                    <div className="flex flex-col gap-y-1 items-center">
                      <p className="text-lg font-nexus-primary text-nexus-black font-bold">
                        {destinationAmount()}
                      </p>
                      <p className="text-sm font-nexus-primary text-nexus-muted-secondary font-medium">
                        To {destChainMeta?.name ?? ''}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="w-12 h-12 bg-gray-200 rounded-nexus-full animate-pulse" />
                )}
              </div>
            </motion.div>
            {/* Text & timer */}
            <motion.div
              className="flex flex-col items-center gap-y-2 w-full"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.35, delay: 0.05 }}
            >
              {error ? (
                <EnhancedInfoMessage error={error} context="transaction" className="px-0" />
              ) : (
                <>
                  <div className="flex items-center justify-center w-full">
                    <span className="text-2xl font-semibold font-nexus-primary text-nexus-black">
                      {Math.floor(timer)}
                    </span>
                    <span className="text-base font-semibold font-nexus-primary text-nexus-black">
                      .
                    </span>
                    <span className="text-base font-semibold font-nexus-primary text-nexus-muted-secondary">
                      {String(Math.floor((timer % 1) * 1000)).padStart(3, '0')}s
                    </span>
                  </div>
                  <div className="relative overflow-hidden">
                    <WordsPullUp text={processing?.statusText} />
                  </div>
                  <p className="w-full text-center font-nexus-primary text-base text-nexus-foreground">
                    {description}
                  </p>
                </>
              )}
              {/* Explorer links */}
              {renderExplorerLinks()}
            </motion.div>
          </div>
        </div>
        {/* Footer */}
      </motion.div>
      <div className="w-full flex flex-col items-center gap-y-3">
        {status === 'success' && (
          <motion.div
            className="w-full px-6"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25, delay: 0.5 }}
          >
            <Button
              onClick={cancelTransaction}
              className="w-full bg-nexus-primary-hover font-nexus-primary text-[16px] text-nexus-snow-white font-semibold h-12 hover:not-even:bg-gray-700 rounded-nexus-md"
            >
              Close
            </Button>
          </motion.div>
        )}
        <div className="flex items-center justify-center gap-x-1.5 text-xs h-8 bg-nexus-secondary-background w-full rounded-b-nexus-xl">
          <span className="text-[#4C4C4C] font-nexus-primary">Powered By</span>
          <SmallAvailLogo />
        </div>
      </div>
    </>
  );
};
