import React, { Fragment, useEffect, useState } from 'react';
import { FormField } from './form-field';
import { cn, formatCost } from '../../utils/utils';
import { EnhancedInfoMessage } from './enhanced-info-message';
import { ActionButtons } from './action-buttons';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { formatUnits } from '../../../core/utils';
import { CHAIN_METADATA, TOKEN_METADATA } from '../../../constants';
import { AmountInput } from './amount-input';

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
      <div className="w-full !font-nexus-primary">
        {/* Header */}
        <div className="mb-6 text-left px-6 font-semibold font-nexus-primary">
          <p className="text-sm text-gray-600">
            To continue, please let this app use at least [{formatCost(minimumAmount)}] {token} from
            your wallet.
          </p>
          <p className="text-sm text-gray-500 mt-1">
            (This lets the smart contract complete the transaction.)
          </p>
        </div>

        {/* Token Information */}
        <div className="mb-6 py-4 px-6">
          <div className="flex items-center justify-between border-b border-[#B3B3B3] py-2">
            <span className="text-sm font-medium text-gray-700 font-nexus-primary">Token</span>
            <div className="flex items-center gap-x-2 w-fit">
              {tokenMetadata?.icon && (
                <img
                  key={tokenMetadata?.name}
                  src={tokenMetadata?.icon}
                  alt={token}
                  className="w-6 h-6 rounded-nexus-full"
                />
              )}
              <span className="font-semibold font-nexus-primary">{token} on</span>
              <div className="flex items-center gap-x-1">
                {sourceChains.map((source, index) => {
                  const chainMeta = CHAIN_METADATA[source?.chainId as keyof typeof CHAIN_METADATA];
                  return (
                    <Fragment key={source?.chainId}>
                      <img
                        src={chainMeta?.logo ?? ''}
                        alt={chainMeta?.name}
                        className={`w-6 h-6 rounded-nexus-full ${index > 0 ? '-ml-5' : ''}`}
                        style={{ zIndex: sourceChains.length - index }}
                        title={chainMeta?.name}
                      />
                    </Fragment>
                  );
                })}
                {sourceChains?.length > 1 && (
                  <span className="font-semibold font-nexus-primary">
                    +{sourceChains.length} chains
                  </span>
                )}
              </div>
            </div>
          </div>
          {currentAllowance && (
            <div className="mt-3 py-2 border-b border-[#B3B3B3]">
              <div className="flex items-center justify-between text-sm font-nexus-primary">
                <span className="text-sm font-medium text-gray-700 font-nexus-primary">
                  Current Allowance
                </span>
                <span className="font-nexus-secondary text-black font-semibold">
                  {currentAllowance}
                </span>
              </div>
            </div>
          )}
        </div>

        {error ? (
          <EnhancedInfoMessage error={error} context="allowance" className="mb-4 px-6" />
        ) : (
          <div className="mb-6 space-y-3 px-6">
            {/* Minimum Option */}
            <div
              className={cn(
                'p-4 rounded-nexus-md border-2 cursor-pointer transition-all relative',
                selectedType === 'minimum'
                  ? 'border-nexus-blue bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300',
              )}
              onClick={() => setSelectedType('minimum')}
            >
              <div className="flex items-center justify-between overflow-clip">
                <div className="flex items-center gap-3 font-nexus-primary">
                  <input
                    type="radio"
                    checked={selectedType === 'minimum'}
                    onChange={() => setSelectedType('minimum')}
                    className="text-blue-600"
                  />
                  <div className="font-nexus-primary">
                    <span className="text-sm font-bold text-gray-900">Minimum</span>
                    <span className="text-base font-bold text-gray-900 ml-2">
                      {formatCost(minimumAmount)}
                    </span>
                  </div>
                </div>
                <span className="bg-nexus-blue font-nexus-primary text-white text-xs px-2 py-1 font-medium absolute top-0 right-0">
                  RECOMMENDED
                </span>
              </div>
            </div>

            {/* Custom Option */}
            <div
              className={cn(
                'p-4 rounded-nexus-md border-2 cursor-pointer transition-all font-nexus-primary',
                selectedType === 'custom'
                  ? 'border-nexus-blue bg-blue-50'
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
                  className="font-nexus-primary"
                >
                  <AmountInput
                    placeholder={`Enter amount ≥ ${inputAmount}`}
                    value={customAmount}
                    disabled={isLoading}
                    onChange={(value) => setCustomAmount(value)}
                    className={cn(
                      'text-black text-base font-semibold font-nexus-primary leading-normal',
                      customAmount && !isCustomValid ? 'border-red-500 focus:border-red-500' : '',
                    )}
                  />
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
        className="border-t border-gray-300/40 bg-gray-100 font-nexus-primary mt-12"
      />
    </>
  );
}
