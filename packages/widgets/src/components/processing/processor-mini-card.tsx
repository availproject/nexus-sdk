import React, { useCallback } from 'react';
import { motion } from 'motion/react';
import SuccessRipple from '../motion/success-ripple';
import { Maximize, ExternalLink } from '../icons';
import { type BridgeAndExecuteResult, SUPPORTED_CHAINS, TOKEN_METADATA } from '@nexus/commons';
import { WordsPullUp } from '../motion/pull-up-words';
import { cn } from '../../utils/utils';
import { ThreeStageProgress } from '../motion/three-stage-progress';
import { Button } from '../motion/button-motion';
import { EnhancedInfoMessage } from '../shared/enhanced-info-message';
import { ProcessorCardProps, SwapSimulationResult } from '../../types';
import { TokenIcon } from '../shared/icons';

export const ProcessorMiniCard: React.FC<ProcessorCardProps> = ({
  status,
  toggleTransactionCollapse,
  sourceChainMeta,
  destChainMeta,
  tokenMeta,
  transactionType,
  simulationResult,
  processing,
  explorerURL,
  explorerURLs,
  description,
  error,
  executionResult,
}: ProcessorCardProps) => {
  const renderTokenIcon = useCallback(() => {
    const progress = processing?.animationProgress ?? 0;

    if (transactionType !== 'swap') {
      return (
        <TokenIcon
          tokenSymbol={tokenMeta?.symbol || 'T'}
          iconUrl={tokenMeta?.icon}
          className="w-6 h-6 rounded-nexus-full border border-white shadow-sm"
        />
      );
    }

    const swapResult = simulationResult as SwapSimulationResult;
    const destSymbol = swapResult?.intent?.destination?.token?.symbol?.toUpperCase();
    const destIcon = destSymbol ? TOKEN_METADATA[destSymbol]?.icon : undefined;
    const sourceIcon = tokenMeta?.icon;

    return (
      <div className="w-6 h-6 rounded-nexus-full border border-white shadow-sm relative overflow-hidden">
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ opacity: progress < 50 ? 1 : 0, scale: progress < 50 ? 1 : 0.95 }}
          transition={{ duration: 0.25 }}
        >
          <TokenIcon
            tokenSymbol={tokenMeta?.symbol || 'T'}
            iconUrl={sourceIcon}
            className="w-6 h-6 rounded-nexus-full"
          />
        </motion.div>
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ opacity: progress >= 50 ? 1 : 0, scale: progress >= 50 ? 1 : 1.05 }}
          transition={{ duration: 0.25 }}
        >
          <TokenIcon
            tokenSymbol={destSymbol || 'T'}
            iconUrl={destIcon}
            className="w-6 h-6 rounded-nexus-full"
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

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center w-full"
    >
      {/* Header */}
      <div className="flex items-center gap-x-4 w-full">
        <div className="flex items-center justify-between w-full gap-x-3">
          {/* Sources */}
          <div className="flex -space-x-1 mb-1">
            {sourceChainMeta?.slice(0, 3).map((chain, index) => (
              <img
                key={chain?.id}
                src={chain?.logo ?? ''}
                alt={chain?.name ?? ''}
                className={cn(
                  'w-8 h-8',
                  index > 0 ? '-ml-3' : '',
                  chain?.id !== SUPPORTED_CHAINS.BASE && chain?.id !== SUPPORTED_CHAINS.BASE_SEPOLIA
                    ? 'rounded-nexus-full'
                    : '',
                )}
                style={{ zIndex: sourceChainMeta?.length - index }}
              />
            ))}
          </div>

          {/* Progress */}
          <motion.div
            className="flex-1 relative w-full"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          >
            <ThreeStageProgress
              progress={processing?.animationProgress}
              hasError={!!error}
              errorProgress={processing?.animationProgress}
              tokenIcon={renderTokenIcon()}
              size="md"
            />
          </motion.div>

          {/* Destination */}
          {destChainMeta ? (
            <SuccessRipple size="sm">
              <img
                src={destChainMeta?.logo}
                alt={destChainMeta?.name}
                className={cn(
                  'w-8 h-8 mb-1',
                  destChainMeta?.id !== SUPPORTED_CHAINS.BASE &&
                    destChainMeta?.id !== SUPPORTED_CHAINS.BASE_SEPOLIA
                    ? 'rounded-nexus-full'
                    : '',
                )}
              />
            </SuccessRipple>
          ) : (
            <div className="w-8 h-8 bg-gray-200 rounded-nexus-full animate-pulse mb-1" />
          )}
        </div>
        <Button
          type="button"
          onPointerDownCapture={(e) => {
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onMouseDownCapture={(e) => {
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleTransactionCollapse();
          }}
          className="p-1 hover:bg-gray-100 rounded-nexus-md transition-colors text-nexus-foreground"
          variant="link"
        >
          <Maximize className="w-6 h-6 text-nexus-muted-secondary" />
        </Button>
      </div>

      {/* Body */}
      {status === 'error' ? (
        <div className="text-left flex flex-col items-start gap-y-0.5 text-ellipsis overflow-hidden">
          <EnhancedInfoMessage error={error} context="transaction" />
        </div>
      ) : (
        <div className="text-left flex flex-col items-start gap-y-0.5 py-0.5 w-full">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.25 }}
          >
            <WordsPullUp
              text={processing?.statusText}
              className="text-[16px] font-nexus-primary font-semibold text-nexus-black"
            />
          </motion.div>
          {status === 'success' &&
            (() => {
              if (transactionType === 'swap') {
                if (explorerURLs?.destination) {
                  return (
                    <Button
                      className="h-fit text-xs text-nexus-accent underline font-semibold font-nexus-primary px-0"
                      size="sm"
                      variant="link"
                      onClick={() => window.open(explorerURLs.destination as string, '_blank')}
                    >
                      View Transaction{' '}
                      <ExternalLink className="w-4 h-4 ml-2 text-nexus-muted-secondary" />
                    </Button>
                  );
                }
                if (explorerURLs?.source) {
                  return (
                    <Button
                      className="h-fit text-xs text-nexus-accent underline font-semibold font-nexus-primary px-0"
                      size="sm"
                      variant="link"
                      onClick={() => window.open(explorerURLs.source as string, '_blank')}
                    >
                      View Transaction{' '}
                      <ExternalLink className="w-4 h-4 ml-2 text-nexus-muted-secondary" />
                    </Button>
                  );
                }
                return null;
              }
              if (transactionType !== 'bridgeAndExecute') {
                if (!explorerURL) return null;
                return (
                  <Button
                    className="h-fit text-xs text-nexus-accent underline font-semibold font-nexus-primary px-0"
                    size="sm"
                    variant="link"
                    onClick={() => window.open(explorerURL, '_blank')}
                  >
                    View on Explorer{' '}
                    <ExternalLink className="w-4 h-4 ml-2 text-nexus-muted-secondary" />
                  </Button>
                );
              }
              const executeUrl = (executionResult as BridgeAndExecuteResult)?.executeExplorerUrl;
              if (executeUrl) {
                return (
                  <Button
                    className="h-fit text-xs text-nexus-accent underline font-semibold font-nexus-primary px-0"
                    size="sm"
                    variant="link"
                    onClick={() => window.open(executeUrl, '_blank')}
                  >
                    View Transaction{' '}
                    <ExternalLink className="w-4 h-4 ml-2 text-nexus-muted-secondary" />
                  </Button>
                );
              }
              return null;
            })()}
          {status !== 'success' && (
            <p className="font-nexus-primary text-sm text-nexus-foreground text-ellipsis overflow-hidden">
              {description}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
};
