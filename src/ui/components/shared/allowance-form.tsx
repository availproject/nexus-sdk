import React, { Fragment, useEffect, useState } from 'react';
import { FormField } from './form-field';
import { Input } from './input';
import { cn } from '../../utils/utils';
import { EnhancedInfoMessage } from './enhanced-info-message';
import { CHAIN_METADATA, TOKEN_METADATA } from '../../..';
import { ActionButtons } from './action-buttons';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { formatUnits } from '../../../core/utils';

export interface AllowanceFormProps {
  token: string;
  minimumAmount: string;
  inputAmount: string;
  sourceChains: { chainId: number; amount: string }[];
  onApprove: (amount: string, isMinimum: boolean) => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function AllowanceForm({
  token,
  minimumAmount,
  inputAmount,
  sourceChains,
  onApprove,
  onCancel,
  isLoading = false,
  error = null,
}: AllowanceFormProps) {
  const [currentAllowance, setCurrentAllowance] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'minimum' | 'custom'>('minimum');
  const [customAmount, setCustomAmount] = useState('');
  const { sdk } = useInternalNexus();

  const tokenMetadata = TOKEN_METADATA[token as keyof typeof TOKEN_METADATA];

  const handleApprove = () => {
    if (selectedType === 'minimum') {
      onApprove(minimumAmount, true);
    } else {
      onApprove(customAmount, false);
    }
  };

  const validateCustomAmount = (amount: string): boolean => {
    if (!amount) return false;
    const numAmount = parseFloat(amount);
    const numInputAmount = parseFloat(inputAmount);
    return !isNaN(numAmount) && numAmount > 0 && numAmount >= numInputAmount;
  };
  const getCurrentAllowance = async () => {
    const allowance = await sdk.getAllowance(sourceChains[0].chainId, [token]);
    const decimals = Number(TOKEN_METADATA[token as keyof typeof TOKEN_METADATA].decimals);
    const formattedAllowance = formatUnits(allowance[0]?.allowance ?? 0n, decimals);
    setCurrentAllowance(formattedAllowance);
  };

  useEffect(() => {
    if (!currentAllowance) {
      getCurrentAllowance();
    }
  }, [sourceChains, token]);

  const isCustomValid = selectedType === 'custom' ? validateCustomAmount(customAmount) : true;
  const isFormValid = selectedType === 'minimum' || isCustomValid;

  return (
    <>
      <div className="w-full !nexus-font-primary">
        {/* Header */}
        <div className="mb-6 text-left px-6 font-semibold nexus-font-primary">
          <p className="text-sm text-gray-600">
            To continue, please let this app use at least [{minimumAmount.slice(0, 7)}] {token} from
            your wallet.
          </p>
          <p className="text-sm text-gray-500 mt-1">
            (This lets the smart contract complete the transaction.)
          </p>
        </div>

        {/* Token Information */}
        <div className="mb-6 py-4 px-6">
          <div className="flex items-center justify-between border-b border-[#B3B3B3] py-2">
            <span className="text-sm font-medium text-gray-700 nexus-font-primary">Token</span>
            <div className="flex items-center gap-2">
              {tokenMetadata?.icon && (
                <img
                  key={tokenMetadata.name}
                  src={tokenMetadata.icon}
                  alt={token}
                  className="w-6 h-6 rounded-full"
                />
              )}
              <span className="font-semibold nexus-font-primary">{token} on</span>
              <div className="flex items-center gap-1">
                {sourceChains.length >= 3 ? (
                  <>
                    {sourceChains.map((source, index) => {
                      const chainMeta =
                        CHAIN_METADATA[source.chainId as keyof typeof CHAIN_METADATA];
                      return (
                        <Fragment key={source.chainId}>
                          <img
                            src={chainMeta?.logo}
                            alt={chainMeta?.name}
                            className={`w-6 h-6 rounded-full ${index > 0 ? '-ml-5' : ''}`}
                            style={{ zIndex: sourceChains.length - index }}
                            title={chainMeta?.name}
                          />
                        </Fragment>
                      );
                    })}
                    <span className="font-semibold nexus-font-primary">
                      +{sourceChains.length} chains
                    </span>
                  </>
                ) : (
                  sourceChains.slice(0, 3).map((source, index) => {
                    const chainMeta = CHAIN_METADATA[source.chainId as keyof typeof CHAIN_METADATA];
                    return (
                      <Fragment key={source.chainId}>
                        <img
                          src={chainMeta?.logo}
                          alt={chainMeta?.name}
                          title={chainMeta?.name}
                          className={`w-6 h-6 rounded-full ${index > 0 ? '-ml-5' : ''}`}
                          style={{ zIndex: sourceChains.length - index }}
                        />
                        <span className="font-semibold nexus-font-primary">{chainMeta?.name}</span>
                      </Fragment>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 py-2 border-b border-[#B3B3B3]">
            <div className="flex items-center justify-between text-sm nexus-font-primary">
              <span className="text-sm font-medium text-gray-700 nexus-font-primary">
                Current Allowance
              </span>
              <span className="nexus-font-secondary text-black font-semibold">
                {currentAllowance?.slice(0, 7)}
              </span>
            </div>
          </div>
        </div>

        {error ? (
          <EnhancedInfoMessage error={error} context="allowance" className="mb-4 px-6" />
        ) : (
          <div className="mb-6 space-y-3 px-6">
            {/* Minimum Option */}
            <div
              className={cn(
                'p-4  rounded-[8px] border-2 cursor-pointer transition-all relative',
                selectedType === 'minimum'
                  ? 'border-[#0375D8] bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300',
              )}
              onClick={() => setSelectedType('minimum')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 nexus-font-primary">
                  <input
                    type="radio"
                    checked={selectedType === 'minimum'}
                    onChange={() => setSelectedType('minimum')}
                    className="text-blue-600"
                  />
                  <div className="nexus-font-primary">
                    <span className="text-sm font-bold text-gray-900">Minimum</span>
                    <span className="text-base font-bold text-gray-900 ml-2">
                      {minimumAmount.slice(0, 7)}
                    </span>
                  </div>
                </div>
                <span className="bg-[#0375D8] nexus-font-primary text-white text-xs px-2 py-1 font-medium absolute top-0 right-0 rounded-tr-[6px]">
                  RECOMMENDED
                </span>
              </div>
            </div>

            {/* Custom Option */}
            <div
              className={cn(
                'p-4 rounded-[8px] border-2 cursor-pointer transition-all nexus-font-primary',
                selectedType === 'custom'
                  ? 'border-[#0375D8] bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300',
              )}
            >
              <div className="flex items-center gap-3" onClick={() => setSelectedType('custom')}>
                <input
                  type="radio"
                  checked={selectedType === 'custom'}
                  onChange={() => setSelectedType('custom')}
                  className="text-blue-600"
                />
                <span className="font-medium text-gray-900">Custom</span>
              </div>
            </div>
            {selectedType === 'custom' && (
              <div className="mt-3">
                <FormField
                  label="Amount"
                  helperText={
                    customAmount && !isCustomValid ? `Amount must be ≥ ${inputAmount}` : undefined
                  }
                  className="nexus-font-primary"
                >
                  <div
                    className={cn(
                      'px-4 py-2 nexus-font-primary rounded-[8px] border border-zinc-400 flex justify-between items-center',
                      'bg-transparent h-12',
                      'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
                      isLoading && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <div className="flex items-center gap-x-1.5 flex-1">
                      <Input
                        placeholder={`Enter amount ≥ ${inputAmount}`}
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        disabled={isLoading}
                        className={cn(
                          '!bg-transparent !focus:ring-0 !focus:border-none !focus:outline-none px-0',
                          customAmount && !isCustomValid
                            ? 'border-red-500 focus:border-red-500'
                            : '',
                          'text-black text-base font-semibold nexus-font-primary leading-normal',
                        )}
                      />
                    </div>
                  </div>
                </FormField>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
      </div>
      <ActionButtons
        onCancel={onCancel}
        onPrimary={handleApprove}
        primaryText="Approve & Continue"
        primaryLoading={isLoading}
        primaryDisabled={!isFormValid || isLoading}
        className="border-t border-zinc-400/40 bg-gray-100 nexus-font-primary mt-12"
      />
    </>
  );
}
