import React from 'react';
import { motion } from 'motion/react';
import { ThreeStageProgress, EnhancedInfoMessage, Button } from '../shared';
import SuccessRipple from '../shared/success-ripple';
import { Maximize, ExternalLink } from 'lucide-react';
import { ProcessorCardProps } from '../../types';
import { WordsPullUp } from '../shared/pull-up-words';

export const ProcessorMiniCard: React.FC<ProcessorCardProps> = ({
  status,
  toggleTransactionCollapse,
  sourceChainMeta,
  destChainMeta,
  tokenMeta,
  transactionType,
  processing,
  explorerURL,
  description,
  error,
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
            {sourceChainMeta.slice(0, 3).map((chain, index) => (
              <img
                key={chain.id}
                src={chain.logo ?? ''}
                alt={chain.name ?? ''}
                className={`w-8 h-8 rounded-full ${index > 0 ? '-ml-3' : ''}`}
                style={{ zIndex: sourceChainMeta.length - index }}
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
              progress={processing.animationProgress}
              hasError={!!error}
              errorProgress={processing.animationProgress}
              tokenIcon={
                tokenMeta?.icon ? (
                  <img
                    src={tokenMeta.icon}
                    alt={tokenMeta.symbol}
                    className="w-6 h-6 rounded-full border border-white shadow-sm"
                  />
                ) : (
                  <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
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
                src={destChainMeta.logo}
                alt={destChainMeta.name}
                className="w-8 h-8 rounded-full mb-1"
              />
            </SuccessRipple>
          ) : (
            <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse mb-1" />
          )}
        </div>
        <Button
          onClick={toggleTransactionCollapse}
          className="p-1 hover:bg-gray-100 rounded-md transition-colors"
          variant="link"
        >
          <Maximize className="w-6 h-6 text-gray-600" />
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
              text={processing.statusText}
              className="text-[16px] nexus-font-primary font-semibold text-black"
            />
          </motion.div>
          {transactionType !== 'bridgeAndExecute' && status === 'success' ? (
            <Button
              className="h-fit text-xs text-[#0375D8] underline font-semibold nexus-font-primary px-0"
              size="sm"
              variant="link"
              onClick={() => window.open(explorerURL ?? '', '_blank')}
            >
              View on Explorer <ExternalLink className="w-4 h-4 ml-2 text-[#666666]" />
            </Button>
          ) : (
            <p className="nexus-font-primary text-sm text-grey-600 text-ellipsis overflow-hidden">
              {description}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
};
