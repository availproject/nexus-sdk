import React, { useCallback, useMemo } from 'react';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import {
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
  SimulationResult,
} from '../../../types';
import { TransactionType } from '../../types';
import { CHAIN_METADATA, TOKEN_METADATA } from '../../../constants';
import { SmallAvailLogo } from '../shared/icons/SmallAvailLogo';
import { CircleX, ExternalLink, Minimize } from 'lucide-react';
import { Button, ThreeStageProgress, EnhancedInfoMessage } from '../shared';
import { getOperationText } from '../../utils/utils';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import SuccessRipple from '../shared/success-ripple';

const TransactionProcessor = ({
  sources,
  token,
  destination,
  transactionType,
  onClose,
}: {
  sources: number[];
  token: string;
  destination: number;
  transactionType: TransactionType;
  onClose: () => void;
}) => {
  const {
    activeTransaction,
    toggleTransactionCollapse,
    timer,
    processing,
    explorerURL,
    cancelTransaction,
  } = useInternalNexus();
  const { simulationResult } = activeTransaction;

  const sourceChainMetaData = useMemo(() => {
    const chainMetas = sources
      .filter((source): source is number => source != null && !isNaN(source))
      .map((source: number) => CHAIN_METADATA[source as keyof typeof CHAIN_METADATA])
      .filter(Boolean); // Remove any undefined chain metadata
    return chainMetas;
  }, [sources]);

  const destinationChainMetaData = useMemo(() => {
    if (!destination || isNaN(destination)) return null;
    return CHAIN_METADATA[destination as keyof typeof CHAIN_METADATA] || null;
  }, [destination]);

  const tokenMetaData = useMemo(() => {
    if (!token) return null;
    return TOKEN_METADATA[token as keyof typeof TOKEN_METADATA] || null;
  }, [token]);

  const handleCollapse = useCallback(() => {
    if (activeTransaction?.status === 'error' || activeTransaction?.status === 'success') {
      cancelTransaction();
      return;
    }
    toggleTransactionCollapse();
  }, [toggleTransactionCollapse, activeTransaction?.status, cancelTransaction]);

  return (
    <div className="w-full h-full bg-white  flex flex-col items-center justify-between rounded-2xl relative overflow-hidden">
      <div className="absolute top-16 flex items-center justify-center pointer-events-none">
        <div className="w-[380px] h-[380px] opacity-20">
          <DotLottieReact
            src="https://lottie.host/17486479-f319-4b3c-8c10-7bf10fcc534b/gRY7aNOi5G.lottie"
            loop
            autoplay={activeTransaction?.status === 'processing'}
            className="w-full h-full object-cover opacity-10 !mix-blend-screen"
          />
        </div>
      </div>
      <Button
        variant={'link'}
        className="w-full flex items-end justify-end text-grey-600"
        onClick={handleCollapse}
      >
        {activeTransaction?.status === 'error' || activeTransaction?.status === 'success' ? (
          <CircleX className="w-6 h-6" />
        ) : (
          <Minimize className="w-6 h-6" />
        )}
      </Button>
      <div className="w-full p-4 relative z-10">
        <div className="w-full flex flex-col items-center gap-y-6">
          <div className="w-full flex items-center">
            {/* Source chain info*/}
            <div className="flex flex-col items-center gap-y-2">
              <div className="flex items-center">
                {sourceChainMetaData.slice(0, 3).map((chain, index) => (
                  <img
                    key={chain.id}
                    src={chain?.logo ?? ''}
                    alt={chain?.name ?? ''}
                    className={`w-12 h-12 rounded-full ${index > 0 ? '-ml-5' : ''}`}
                    style={{ zIndex: sourceChainMetaData.length - index }}
                  />
                ))}
              </div>

              <div className="flex flex-col gap-y-1 items-center">
                <p className="text-lg font-primary text-primary font-bold">
                  {transactionType === 'bridge' || transactionType === 'transfer'
                    ? (simulationResult as SimulationResult)?.intent?.sourcesTotal
                    : (simulationResult as BridgeAndExecuteSimulationResult)?.bridgeSimulation
                        ?.intent?.sourcesTotal}
                </p>
                <p className="text-sm font-primary text-primary-hover font-medium">
                  {`From ${
                    transactionType === 'bridge' || transactionType === 'transfer'
                      ? (simulationResult as SimulationResult)?.intent?.sources.length
                      : (simulationResult as BridgeAndExecuteSimulationResult)?.bridgeSimulation
                          ?.intent?.sources.length
                  } chains`}
                </p>
              </div>
            </div>
            {/** Token info and progress bars */}
            <div className="flex-1 flex flex-col items-center justify-center px-2 relative">
              <div className="relative w-full flex items-center justify-center">
                <div className="w-full max-w-[300px] relative">
                  <ThreeStageProgress
                    progress={processing.animationProgress}
                    hasError={!!activeTransaction?.error}
                    errorProgress={processing.animationProgress}
                    tokenIcon={
                      <div className="w-10 h-10 bg-white rounded-full border-2 border-gray-200 flex items-center justify-center shadow-md">
                        {tokenMetaData?.icon ? (
                          <img
                            src={tokenMetaData?.icon ?? ''}
                            alt={tokenMetaData?.symbol ?? ''}
                            className="w-8 h-8 rounded-full"
                          />
                        ) : (
                          <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-xs font-bold">
                              {tokenMetaData?.symbol?.[0] || 'T'}
                            </span>
                          </div>
                        )}
                      </div>
                    }
                    size="lg"
                  />
                </div>
              </div>
            </div>
            {/* Destination chain info*/}
            <div className="flex flex-col items-center gap-y-2 relative">
              {destinationChainMetaData ? (
                <>
                  <SuccessRipple size="md">
                    <img
                      src={destinationChainMetaData.logo ?? ''}
                      alt={destinationChainMetaData.name ?? ''}
                      className="w-12 h-12 rounded-full"
                    />
                  </SuccessRipple>

                  <div className="flex flex-col gap-y-1 items-center">
                    <p className="text-lg font-primary text-primary font-bold">
                      {transactionType === 'bridge' || transactionType === 'transfer'
                        ? (simulationResult as SimulationResult)?.intent?.destination?.amount
                        : (simulationResult as BridgeAndExecuteSimulationResult)?.bridgeSimulation
                            ?.intent?.destination?.amount}
                    </p>
                    <p className="text-sm font-primary text-primary-hover font-medium">
                      To {destinationChainMetaData.name}
                    </p>
                  </div>
                </>
              ) : (
                <div className="w-12 h-12 bg-gray-200 rounded-full animate-pulse" />
              )}
            </div>
          </div>
          <div className="flex flex-col items-center gap-y-4 w-full">
            {activeTransaction?.error ? (
              <EnhancedInfoMessage error={activeTransaction.error} context="transaction" />
            ) : (
              <>
                <div className="flex items-center justify-center w-full">
                  <span className="text-2xl font-semibold text-black">{Math.floor(timer)}</span>
                  <span className="text-base font-semibold text-black">.</span>
                  <span className="text-base font-semibold text-gray-600">
                    {String(Math.floor((timer % 1) * 1000)).padStart(3, '0')}s
                  </span>
                </div>
                <p className="w-full text-center text-black font-primary font-bold text-2xl">
                  {processing?.statusText}
                </p>
                {transactionType && (
                  <p className="w-full text-center font-primary text-base  text-grey-600">{`${getOperationText(transactionType)} ${
                    tokenMetaData?.symbol || 'token'
                  } from ${sourceChainMetaData.length > 1 ? 'multiple chains' : sourceChainMetaData[0]?.name + ' chain' || 'source chain'}  to ${destinationChainMetaData?.name || 'destination chain'}`}</p>
                )}
              </>
            )}
            {transactionType === 'bridgeAndExecute' ? (
              <div className="flex items-center gap-x-2">
                {explorerURL && (
                  <Button
                    variant={'link'}
                    className=" text-accent underline text-base font-bold"
                    onClick={() => {
                      window.open(explorerURL, '_blank');
                    }}
                  >
                    Bridge Transaction <ExternalLink className="w-6 h-6 ml-2 text-[#666666]" />
                  </Button>
                )}
                {(activeTransaction?.executionResult as BridgeAndExecuteResult)
                  ?.executeExplorerUrl && (
                  <Button
                    variant={'link'}
                    className=" text-accent underline text-base font-bold"
                    onClick={() => {
                      window.open(
                        (activeTransaction?.executionResult as BridgeAndExecuteResult)
                          ?.executeExplorerUrl,
                        '_blank',
                      );
                    }}
                  >
                    Execute Transaction <ExternalLink className="w-6 h-6 ml-2 text-[#666666]" />
                  </Button>
                )}
              </div>
            ) : (
              explorerURL && (
                <Button
                  variant={'link'}
                  className=" text-accent underline text-base font-bold"
                  onClick={() => {
                    window.open(explorerURL, '_blank');
                  }}
                >
                  View on Explorer <ExternalLink className="w-6 h-6 ml-2 text-[#666666]" />
                </Button>
              )
            )}
            {activeTransaction?.status === 'success' && (
              <Button onClick={onClose} className="w-full">
                Close
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center gap-x-1.5 text-xs h-8 bg-[#BED8EE66] w-full rounded-b-xl">
        <span className="text-[#4C4C4C] font-primary">Powered By</span>
        <SmallAvailLogo />
      </div>
    </div>
  );
};

export default TransactionProcessor;
