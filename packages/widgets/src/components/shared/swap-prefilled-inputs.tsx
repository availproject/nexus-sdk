import { CHAIN_METADATA, SUPPORTED_CHAINS, formatBalance } from '@nexus/commons';
import { cn } from '../../utils/utils';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { getFiatValue } from '../../utils/balance-utils';
import { SwapInputData, SwapSimulationResult } from '../../types';
import { TokenIcon } from './icons';

interface SwapPrefilledInputsProps {
  inputData: Omit<SwapInputData, 'toAmount'>;
  className?: string;
}

const SwapPrefilledInputs = ({ inputData, className = '' }: SwapPrefilledInputsProps) => {
  const { exchangeRates, activeTransaction } = useInternalNexus();
  const sourceChain = CHAIN_METADATA[inputData?.fromChainID ?? SUPPORTED_CHAINS.ETHEREUM];
  const destinationChain = CHAIN_METADATA[inputData?.toChainID ?? SUPPORTED_CHAINS.ETHEREUM];
  const transactionIntent = (activeTransaction?.simulationResult as SwapSimulationResult)?.intent;

  return (
    <div className={cn('flex items-start flex-col gap-y-4 px-6', className)}>
      <div className="flex flex-col items-start gap-y-2">
        <div className="flex items-center gap-x-2">
          <p className="text-nexus-muted-secondary font-semibold text-sm leading-[18px]">
            Swapping
          </p>
        </div>
        <div className="flex flex-col items-start gap-y-3">
          <div className="flex items-center gap-x-1">
            <TokenIcon
              tokenSymbol={inputData?.fromTokenAddress || 'ETH'}
              className="w-6 h-6 border border-nexus-border-secondary rounded-full"
            />
            <p className="text-nexus-black text-[32px] font-semibold leading-0 uppercase font-nexus-primary text-ellipsis">
              {inputData?.fromAmount} {inputData?.fromTokenAddress}
            </p>
            <img
              src={sourceChain?.logo}
              alt={sourceChain?.shortName}
              className={cn(
                'w-6 h-6',
                sourceChain?.id !== SUPPORTED_CHAINS.BASE &&
                  sourceChain?.id !== SUPPORTED_CHAINS.BASE_SEPOLIA
                  ? 'rounded-full'
                  : '',
              )}
            />
          </div>
          <div className="flex items-center justify-center w-full">
            <p className="text-nexus-foreground text-base font-semibold font-nexus-primary">↓</p>
          </div>
          <div className={cn('flex items-center gap-x-1')}>
            <TokenIcon
              tokenSymbol={inputData?.toTokenAddress || 'ETH'}
              className="w-6 h-6 border border-nexus-border-secondary rounded-full"
            />
            <p className="text-nexus-black text-[32px] font-semibold leading-0 uppercase font-nexus-primary text-ellipsis">
              {transactionIntent
                ? formatBalance(
                    transactionIntent?.destination?.amount,
                    transactionIntent?.destination?.token?.decimals,
                    6,
                  )
                : '...'}{' '}
              {inputData?.toTokenAddress}
            </p>
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
          </div>
        </div>
      </div>
      {inputData?.fromAmount && inputData?.fromTokenAddress && (
        <p className="text-nexus-accent-green font-semibold leading-6 text-lg font-nexus-primary">
          {getFiatValue(inputData?.fromAmount, inputData?.fromTokenAddress, exchangeRates)}
        </p>
      )}
    </div>
  );
};

export default SwapPrefilledInputs;
