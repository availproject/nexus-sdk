import React, { useState } from 'react';
import { InfoMessage } from './info-message';
import { Button } from './button-motion';
import {
  isChainError,
  extractChainIdFromError,
  addChainToWallet,
  formatErrorForUI,
} from '../../utils/utils';
import { CHAIN_METADATA } from '../../..';
import { Plus } from '../icons';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { logger } from '../../../core/utils';
import LoadingDots from './loading-dots';

interface EnhancedInfoMessageProps {
  error: unknown;
  context?: string;
  className?: string;
}

export function EnhancedInfoMessage({ error, context, className }: EnhancedInfoMessageProps) {
  const [isAddingChain, setIsAddingChain] = useState(false);
  const [chainAdded, setChainAdded] = useState(false);
  const { sdk } = useInternalNexus();

  const isChainRelatedError = isChainError(error);
  const chainId = isChainRelatedError ? extractChainIdFromError(error) : null;
  const chainMetadata = chainId ? CHAIN_METADATA[chainId] : null;

  const handleAddChain = async () => {
    if (!chainId) return;

    setIsAddingChain(true);
    try {
      const provider = sdk.getEVMProviderWithCA();
      const success = await addChainToWallet(chainId, provider);
      if (success) {
        setChainAdded(true);
      }
    } catch (err) {
      logger.error('Failed to add chain:', err as Error);
    } finally {
      setIsAddingChain(false);
    }
  };

  const formattedError = formatErrorForUI(error, context);

  if (isChainRelatedError && chainMetadata && !chainAdded) {
    return (
      <InfoMessage variant="error" className={className}>
        <div className="space-y-3">
          <p className="text-sm font-nexus-primary text-red-600 font-bold">{formattedError}</p>

          <div className="flex items-center gap-2 p-3 bg-red-50 rounded-nexus-md border border-red-200">
            <img
              src={chainMetadata.logo}
              alt={chainMetadata.name}
              className="w-8 h-8 rounded-nexus-full"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold font-nexus-primary text-gray-900">{chainMetadata.name}</p>
              <p className="text-xs font-nexus-primary text-gray-600">Chain ID: {chainId}</p>
            </div>
            <Button
              onClick={handleAddChain}
              disabled={isAddingChain}
              size="sm"
              className="bg-nexus-blue hover:bg-nexus-blue/90 text-white"
            >
              {isAddingChain ? (
                <>
                  <LoadingDots />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Chain
                </>
              )}
            </Button>
          </div>

          <p className="text-xs font-nexus-primary text-gray-500">
            This will add {chainMetadata.name} network to your wallet so you can use it for
            transactions.
          </p>
        </div>
      </InfoMessage>
    );
  }

  if (chainAdded) {
    return (
      <InfoMessage variant="success" className={className}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-green-100 rounded-nexus-full flex items-center justify-center">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold font-nexus-primary text-green-800">
              {chainMetadata?.name} network added successfully!
            </p>
            <p className="text-xs font-nexus-primary text-green-600 mt-1">You can now retry your transaction.</p>
          </div>
        </div>
      </InfoMessage>
    );
  }

  // Fallback to regular formatted error message
  return (
    <InfoMessage variant="error" className={className}>
      <p className="text-sm font-nexus-primary text-red-600 font-bold">{formattedError}</p>
    </InfoMessage>
  );
}
