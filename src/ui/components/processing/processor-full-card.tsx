import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { Button, ThreeStageProgress, EnhancedInfoMessage } from '../shared';
import SuccessRipple from '../shared/success-ripple';
import { Minimize, CircleX, ExternalLink } from 'lucide-react';
import { WordsPullUp } from '../shared/pull-up-words';
import { ProcessorCardProps } from '../../types';
import {
  BridgeAndExecuteSimulationResult,
  BridgeAndExecuteResult,
  SimulationResult,
} from '../../../types';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { SmallAvailLogo } from '../shared/icons/SmallAvailLogo';
import type { DotLottie } from '@lottiefiles/dotlottie-web';

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
  timer,
  description,
  error,
  executionResult,
}: ProcessorCardProps) => {
  // Hold a reference to the underlying DotLottie player so we can
  // manually call `resize()` when the card finishes a FLIP layout
  // transition (prevents the "buffer size mismatch" console warning).
  const lottieRef = useRef<DotLottie | null>(null);

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
              dotLottieRefCallback={(instance) => {
                lottieRef.current = instance;
              }}
            />
          </div>
        </motion.div>
        <Button
          variant="link"
          className="w-full flex items-end justify-end text-grey-600 mt-6 px-6"
          onClick={() => {
            if (status === 'error' || status === 'success') {
              cancelTransaction();
            } else {
              toggleTransactionCollapse();
            }
          }}
        >
          {status === 'error' || status === 'success' ? (
            <CircleX className="w-6 h-6" />
          ) : (
            <Minimize className="w-6 h-6" />
          )}
        </Button>
        <div className="w-full p-4 relative z-10 mt-12">
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
                  {sourceChainMeta.slice(0, 3).map((chain, index) => (
                    <img
                      key={chain.id}
                      src={chain.logo ?? ''}
                      alt={chain.name ?? ''}
                      className={`w-12 h-12 rounded-full ${index > 0 ? '-ml-5' : ''}`}
                      style={{ zIndex: sourceChainMeta.length - index }}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-y-1 items-center">
                  <p className="text-lg nexus-font-primary text-black font-bold">
                    {transactionType === 'bridge' || transactionType === 'transfer'
                      ? (simulationResult as SimulationResult)?.intent?.sourcesTotal
                      : (simulationResult as BridgeAndExecuteSimulationResult)?.bridgeSimulation
                          ?.intent?.sourcesTotal}
                  </p>
                  <p className="text-sm nexus-font-primary text-[#666666] font-medium">
                    From {sourceChainMeta.length} chain{sourceChainMeta.length > 1 ? 's' : ''}
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
                      progress={processing.animationProgress}
                      hasError={!!error}
                      errorProgress={processing.animationProgress}
                      tokenIcon={
                        <div className="w-10 h-10 bg-white rounded-full border-2 border-gray-200 flex items-center justify-center shadow-md">
                          {tokenMeta?.icon ? (
                            <img
                              src={tokenMeta.icon}
                              alt={tokenMeta.symbol}
                              className="w-8 h-8 rounded-full"
                            />
                          ) : (
                            <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                              <span className="text-white text-xs font-bold">
                                {tokenMeta?.symbol?.[0] || 'T'}
                              </span>
                            </div>
                          )}
                        </div>
                      }
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
                        src={destChainMeta.logo ?? ''}
                        alt={destChainMeta.name ?? ''}
                        className="w-12 h-12 rounded-full"
                      />
                    </SuccessRipple>
                    <div className="flex flex-col gap-y-1 items-center">
                      <p className="text-lg nexus-font-primary text-black font-bold">
                        {transactionType === 'bridge' || transactionType === 'transfer'
                          ? (simulationResult as SimulationResult)?.intent?.destination?.amount
                          : (simulationResult as BridgeAndExecuteSimulationResult)?.bridgeSimulation
                              ?.intent?.destination?.amount}
                      </p>
                      <p className="text-sm nexus-font-primary text-[#666666] font-medium">
                        To {destChainMeta.name}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="w-12 h-12 bg-gray-200 rounded-full animate-pulse" />
                )}
              </div>
            </motion.div>
            {/* Text & timer */}
            <motion.div
              className="flex flex-col items-center gap-y-4 w-full"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.35, delay: 0.05 }}
            >
              {error ? (
                <EnhancedInfoMessage error={error} context="transaction" />
              ) : (
                <>
                  <div className="flex items-center justify-center w-full">
                    <span className="text-2xl font-semibold nexus-font-primary text-black">
                      {Math.floor(timer)}
                    </span>
                    <span className="text-base font-semibold nexus-font-primary text-black">.</span>
                    <span className="text-base font-semibold nexus-font-primary text-gray-600">
                      {String(Math.floor((timer % 1) * 1000)).padStart(3, '0')}s
                    </span>
                  </div>
                  <div className="relative overflow-hidden">
                    <WordsPullUp text={processing.statusText} />
                  </div>
                  <p className="w-full text-center nexus-font-primary text-base text-grey-600">
                    {description}
                  </p>
                </>
              )}
              {/* Explorer links */}
              {transactionType === 'bridgeAndExecute' ? (
                <div className="flex flex-col items-center gap-y-2">
                  {explorerURL && (
                    <Button
                      variant="link"
                      className=" text-[#0375D8] underline text-base font-semibold nexus-font-primary"
                      onClick={() => window.open(explorerURL, '_blank')}
                    >
                      View Bridge Transaction{' '}
                      <ExternalLink className="w-6 h-6 ml-2 text-[#666666]" />
                    </Button>
                  )}
                  {(executionResult as BridgeAndExecuteResult)?.executeExplorerUrl && (
                    <Button
                      variant="link"
                      className=" text-[#0375D8] underline text-base font-semibold nexus-font-primary"
                      onClick={() =>
                        window.open(
                          (executionResult as BridgeAndExecuteResult).executeExplorerUrl,
                          '_blank',
                        )
                      }
                    >
                      View Execute Transaction{' '}
                      <ExternalLink className="w-6 h-6 ml-2 text-[#666666]" />
                    </Button>
                  )}
                </div>
              ) : (
                explorerURL && (
                  <Button
                    variant="link"
                    className=" text-[#0375D8] underline text-base font-semibold nexus-font-primary"
                    onClick={() => window.open(explorerURL, '_blank')}
                  >
                    View on Explorer <ExternalLink className="w-6 h-6 ml-2 text-[#666666]" />
                  </Button>
                )
              )}
            </motion.div>
          </div>
        </div>
        {/* Footer */}
      </motion.div>
      <div className="w-full flex flex-col items-center gap-y-6">
        {status === 'success' && (
          <motion.div
            className="w-full px-6"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25, delay: 0.5 }}
          >
            <Button
              onClick={cancelTransaction}
              className="w-full bg-[#2B2B2B] nexus-font-primary text-[16px] font-semibold h-12 hover:not-even:bg-gray-700 rounded-[8px]"
            >
              Close
            </Button>
          </motion.div>
        )}
        <div className="flex items-center justify-center gap-x-1.5 text-xs h-8 bg-[#BED8EE66] w-full rounded-b-xl">
          <span className="text-[#4C4C4C] nexus-font-primary">Powered By</span>
          <SmallAvailLogo />
        </div>
      </div>
    </>
  );
};
