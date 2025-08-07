import React from 'react';
import { CHAIN_METADATA, SUPPORTED_CHAINS, TOKEN_METADATA } from '../../../constants';
import { cn } from '../../utils/utils';

interface PrefilledInputsProps {
  inputData: {
    chainId?: number;
    toChainId?: number;
    token?: string;
    amount?: string | number;
    recipient?: string;
  };
  className?: string;
}

const PrefilledInputs = ({ inputData, className = '' }: PrefilledInputsProps) => {
  const destinationChain =
    CHAIN_METADATA[inputData?.chainId ?? inputData?.toChainId ?? SUPPORTED_CHAINS.ETHEREUM];
  const destinationToken = TOKEN_METADATA[inputData?.token ?? 'ETH'];
  return (
    <div className={cn('flex items-start flex-col gap-y-4 px-6', className)}>
      <div className="flex flex-col items-start gap-y-2">
        <p className="text-nexus-muted-secondary font-semibold text-sm leading-[18px]">Sending</p>
        <div className="flex items-center gap-x-2">
          <div className="flex items-center gap-x-1">
            <img
              src={destinationToken?.icon}
              alt={destinationToken?.name}
              className="w-6 h-6 border border-nexus-border-secondary rounded-full"
            />
            <p className="text-nexus-black text-[32px] font-semibold leading-0 uppercase font-nexus-primary">
              {inputData?.amount} {inputData?.token}
            </p>
          </div>
          <div className="flex items-center gap-x-2">
            <p className="text-nexus-foreground text-base font-semibold font-nexus-primary">To</p>
            <img
              src={destinationChain?.logo}
              alt={destinationChain?.shortName}
              className={cn(
                'w-6 h-6',
                destinationChain?.id !== SUPPORTED_CHAINS.BASE &&
                  destinationChain?.id !== SUPPORTED_CHAINS.BASE_SEPOLIA
                  ? 'rounded-full'
                  : '',
              )}
            />
            <p className="text-nexus-foreground text-base font-semibold uppercase font-nexus-primary">
              {destinationChain?.name}
            </p>
          </div>
        </div>
      </div>
      <p className="text-nexus-accent-green font-semibold leading-6 text-lg font-nexus-primary">
        ≈ $2905.67
      </p>
    </div>
  );
};

export default PrefilledInputs;
