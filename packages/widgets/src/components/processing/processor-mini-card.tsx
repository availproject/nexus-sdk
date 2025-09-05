import React from 'react';
import { motion } from 'motion/react';
import SuccessRipple from '../motion/success-ripple';
import { Maximize, ExternalLink } from '../icons';
import { type BridgeAndExecuteResult, SUPPORTED_CHAINS } from '@nexus/commons';
import { WordsPullUp } from '../motion/pull-up-words';
import { cn } from '../../utils/utils';
import { ThreeStageProgress } from '../motion/three-stage-progress';
import { Button } from '../motion/button-motion';
import { EnhancedInfoMessage } from '../shared/enhanced-info-message';
import { ProcessorCardProps } from '../../types';

export const ProcessorMiniCard: React.FC<ProcessorCardProps> = ({
  status,
  toggleTransactionCollapse,
  sourceChainMeta,
  destChainMeta,
  tokenMeta,
  transactionType,
  processing,
  explorerURL,
  explorerURLs,
  description,
  error,
  executionResult,
}: ProcessorCardProps) => {
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
              tokenIcon={
                tokenMeta?.icon ? (
                  <img
                    src={tokenMeta?.icon}
                    alt={tokenMeta?.symbol}
                    className="w-6 h-6 rounded-nexus-full border border-white shadow-sm"
                  />
                ) : (
                  <div className="w-4 h-4 bg-blue-500 rounded-nexus-full flex items-center justify-center">
                    <span className="text-white text-[8px] font-bold">
                      {tokenMeta?.symbol?.[0] || 'T'}
                    </span>
                  </div>
                )
              }
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
            (transactionType === 'swap' ? (
              // For swap, prioritize showing destination transaction link
              explorerURLs?.destination ? (
                <Button
                  className="h-fit text-xs text-nexus-accent underline font-semibold font-nexus-primary px-0"
                  size="sm"
                  variant="link"
                  onClick={() => window.open(explorerURLs.destination!, '_blank')}
                >
                  View Transaction{' '}
                  <ExternalLink className="w-4 h-4 ml-2 text-nexus-muted-secondary" />
                </Button>
              ) : explorerURLs?.source ? (
                <Button
                  className="h-fit text-xs text-nexus-accent underline font-semibold font-nexus-primary px-0"
                  size="sm"
                  variant="link"
                  onClick={() => window.open(explorerURLs.source!, '_blank')}
                >
                  View Transaction{' '}
                  <ExternalLink className="w-4 h-4 ml-2 text-nexus-muted-secondary" />
                </Button>
              ) : null
            ) : transactionType !== 'bridgeAndExecute' ? (
              <Button
                className="h-fit text-xs text-nexus-accent underline font-semibold font-nexus-primary px-0"
                size="sm"
                variant="link"
                onClick={() => window.open(explorerURL ?? '', '_blank')}
              >
                View on Explorer{' '}
                <ExternalLink className="w-4 h-4 ml-2 text-nexus-muted-secondary" />
              </Button>
            ) : (
              // For bridgeAndExecute, show execute transaction link (bridge link handled in full card)
              (executionResult as BridgeAndExecuteResult)?.executeExplorerUrl && (
                <Button
                  className="h-fit text-xs text-nexus-accent underline font-semibold font-nexus-primary px-0"
                  size="sm"
                  variant="link"
                  onClick={() =>
                    window.open(
                      (executionResult as BridgeAndExecuteResult)?.executeExplorerUrl ?? '',
                      '_blank',
                    )
                  }
                >
                  View Transaction{' '}
                  <ExternalLink className="w-4 h-4 ml-2 text-nexus-muted-secondary" />
                </Button>
              )
            ))}
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
