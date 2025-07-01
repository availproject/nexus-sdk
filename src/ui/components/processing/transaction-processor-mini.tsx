import React, { useRef, useEffect, useState } from 'react';
import { CircleX, Maximize, TriangleAlert } from 'lucide-react';
import { useNexus } from '../../providers/NexusProvider';
import { CHAIN_METADATA, TOKEN_METADATA, TransactionType } from '../../..';

import { getOperationText } from '../../utils/utils';
import { Button, InfoMessage, ThreeStageProgress } from '../shared';
import SuccessRipple from '../shared/success-ripple';

interface TransactionProcessorMiniProps {
  sources: number[];
  token: string;
  destination: number;
  transactionType: TransactionType;
}

export const TransactionProcessorMini: React.FC<TransactionProcessorMiniProps> = ({
  sources,
  token,
  destination,
  transactionType,
}) => {
  const {
    toggleTransactionCollapse,
    activeTransaction,
    processing,
    cancelTransaction,
    explorerURL,
  } = useNexus();

  const dragRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const sourceChainMetaData = sources
    .filter((source): source is number => source != null && !isNaN(source))
    .map((source: number) => CHAIN_METADATA[source as keyof typeof CHAIN_METADATA])
    .filter(Boolean);

  const destinationChainMetaData =
    destination && !isNaN(destination)
      ? CHAIN_METADATA[destination as keyof typeof CHAIN_METADATA]
      : null;
  const tokenMetaData = token ? TOKEN_METADATA[token as keyof typeof TOKEN_METADATA] : null;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const newPosition = {
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      };

      // Keep within viewport bounds
      const rect = dragRef.current?.getBoundingClientRect();
      if (rect) {
        newPosition.x = Math.max(0, Math.min(window.innerWidth - rect.width, newPosition.x));
        newPosition.y = Math.max(0, Math.min(window.innerHeight - rect.height, newPosition.y));
      }

      setPosition(newPosition);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!dragRef.current) return;

    const rect = dragRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  };

  const handleExpand = () => {
    if (activeTransaction?.status === 'error' || activeTransaction?.status === 'success') {
      cancelTransaction();
      return;
    }
    toggleTransactionCollapse();
  };

  return (
    <div
      ref={dragRef}
      className="fixed z-50 bg-white rounded-2xl shadow-lg border border-gray-200 p-3 min-w-[280px] cursor-move"
      style={{
        left: position.x,
        top: position.y,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header with drag handle and expand button */}
      <div className="flex items-center mb-2 gap-x-4">
        <div className="flex items-center justify-between w-full gap-x-3">
          {/* Source */}
          <div className="flex -space-x-1 mb-1">
            {sourceChainMetaData.slice(0, 3).map((chain, index) => (
              <img
                key={chain.id}
                src={chain?.logo ?? ''}
                alt={chain?.name ?? ''}
                className={`w-8 h-8 rounded-full ${index > 0 ? '-ml-3' : ''}`}
                style={{ zIndex: sourceChainMetaData.length - index }}
              />
            ))}
          </div>

          {/* Progress indicator */}
          <div className="flex-1 relative w-full">
            <ThreeStageProgress
              progress={processing.animationProgress}
              hasError={!!activeTransaction?.error}
              errorProgress={processing.animationProgress}
              tokenIcon={
                tokenMetaData?.icon ? (
                  <img
                    src={tokenMetaData.icon}
                    alt={tokenMetaData.symbol}
                    className="w-6 h-6 rounded-full border border-white shadow-sm"
                  />
                ) : (
                  <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-[8px] font-bold">
                      {tokenMetaData?.symbol?.[0] || 'T'}
                    </span>
                  </div>
                )
              }
              size="md"
            />
          </div>

          {/* Destination */}
          {destinationChainMetaData ? (
            <SuccessRipple size="sm">
              <img
                src={destinationChainMetaData.logo}
                alt={destinationChainMetaData.name}
                className="w-8 h-8 rounded-full mb-1"
              />
            </SuccessRipple>
          ) : (
            <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse mb-1" />
          )}
        </div>
        <Button
          onClick={handleExpand}
          className="p-1 hover:bg-gray-100 rounded-md transition-colors"
          variant={'link'}
        >
          {activeTransaction?.status === 'error' || activeTransaction?.status === 'success' ? (
            <CircleX className="w-6 h-6 text-black" />
          ) : (
            <Maximize className="w-6 h-6 text-gray-600" />
          )}
        </Button>
      </div>
      {activeTransaction?.status === 'error' ? (
        <div className="text-left flex flex-col items-start gap-y-0.5">
          <InfoMessage variant={'error'}>
            <p className="text-sm font-primary text-destructive-base font-bold flex items-center gap-x-2">
              <TriangleAlert className="w-4 h-4 text-destructive-base ml-1" />
              {activeTransaction?.error?.message}
            </p>
          </InfoMessage>
        </div>
      ) : (
        <div className="text-left flex flex-col items-start gap-y-0.5">
          <div className="text-base font-semibold text-black mb-1">{processing.statusText}</div>
          {activeTransaction?.status === 'success' ? (
            <Button
              className="text-xs"
              onClick={() => {
                window.open(explorerURL ?? '', '_blank');
              }}
            >
              View on Explorer
            </Button>
          ) : (
            <p className="font-primary text-sm text-grey-600">{`${getOperationText(transactionType)} ${
              tokenMetaData?.symbol || 'token'
            } from ${sourceChainMetaData.length > 1 ? 'multiple chains' : sourceChainMetaData[0]?.name + ' chain' || 'source chain'}  to ${destinationChainMetaData?.name || 'destination chain'}`}</p>
          )}
        </div>
      )}
    </div>
  );
};
