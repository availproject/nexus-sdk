import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { cn, formatCost } from '../../utils/utils';
import { EnhancedInfoMessage } from './enhanced-info-message';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { formatUnits } from '../../../core/utils';
import { CHAIN_METADATA, SUPPORTED_CHAINS, TOKEN_METADATA } from '../../../constants';
import { FormField } from '../motion/form-field';
import { Input } from '../motion/input';

export interface AllowanceFormProps {
  token: string;
  minimumAmount: string;
  inputAmount: string;
  sourceChains: { chainId: number; amount: string; needsApproval?: boolean }[];
  onApprove: (amount: string, isMinimum: boolean) => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
  // Expose form state for external button handling
  onFormStateChange?: (isValid: boolean, approveHandler: () => void) => void;
}

export function AllowanceForm({
  token,
  minimumAmount,
  inputAmount,
  sourceChains,
  onApprove,
  onCancel: _onCancel,
  isLoading = false,
  error = null,
  onFormStateChange,
}: AllowanceFormProps) {
  const [currentAllowance, setCurrentAllowance] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'minimum' | 'custom'>('minimum');
  const [customAmount, setCustomAmount] = useState('');
  const { sdk } = useInternalNexus();

  // Keep latest form values in refs to avoid stale closures when parent stores handler
  const latestValuesRef = useRef({ selectedType, customAmount, minimumAmount });
  latestValuesRef.current.selectedType = selectedType;
  latestValuesRef.current.customAmount = customAmount;
  latestValuesRef.current.minimumAmount = minimumAmount;

  const tokenMetadata = TOKEN_METADATA[token as keyof typeof TOKEN_METADATA];

  // Stable handler that reads latest values from refs, so parent always has a fresh handler
  const stableApproveHandler = useCallback(() => {
    const { selectedType, customAmount, minimumAmount } = latestValuesRef.current;
    if (selectedType === 'minimum') {
      onApprove(minimumAmount, true);
    } else {
      onApprove(customAmount, false);
    }
  }, [onApprove]);

  const validateCustomAmount = (amount: string): boolean => {
    if (!amount) return false;
    const numAmount = parseFloat(amount);
    const numInputAmount = parseFloat(inputAmount);
    return !isNaN(numAmount) && numAmount > 0 && numAmount >= numInputAmount;
  };

  const getCurrentAllowance = async () => {
    // Find the first chain that actually needs allowance
    const chainThatNeedsAllowance = sourceChains.find((chain) => chain.needsApproval === true);

    if (!chainThatNeedsAllowance) {
      // If no chain needs approval, show allowance from first chain or 0
      const firstChain = sourceChains[0];
      if (firstChain) {
        const allowance = await sdk.getAllowance(firstChain.chainId, [token]);
        const decimals = Number(TOKEN_METADATA[token as keyof typeof TOKEN_METADATA].decimals);
        const formattedAllowance = formatUnits(allowance[0]?.allowance ?? 0n, decimals);
        setCurrentAllowance(formattedAllowance);
      } else {
        setCurrentAllowance('0');
      }
      return;
    }

    // Get allowance from the chain that needs approval
    const allowance = await sdk.getAllowance(chainThatNeedsAllowance.chainId, [token]);
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

  // Notify parent of form state changes; avoid depending on onFormStateChange to prevent loops
  useEffect(() => {
    if (onFormStateChange) {
      onFormStateChange(isFormValid, stableApproveHandler);
    }
  }, [isFormValid]);

  return (
    <div className="flex flex-col h-full w-full overflow-y-auto">
      <div className="flex-1 w-full">
        {/* Header */}
        <div className="my-4 text-left px-6">
          <p className="text-xs text-nexus-muted-secondary font-semibold font-nexus-primary">
            Allow access to {formatCost(minimumAmount)} {token} to complete your transaction.
          </p>
        </div>

        {/* Token Information */}
        <div className="mb-6 px-6">
          <div className="flex items-center justify-between border-b border-nexus-input py-2">
            <span className="text-xs font-semibold text-nexus-muted font-nexus-primary">Token</span>
            <div className="flex items-center gap-x-2 w-fit">
              {tokenMetadata?.icon && (
                <img
                  key={tokenMetadata?.name}
                  src={tokenMetadata?.icon}
                  alt={token}
                  className="w-6 h-6 rounded-nexus-full"
                />
              )}
              <span className="font-semibold font-nexus-primary text-nexus-black text-base">
                {token} on
              </span>
              <div className="flex items-center gap-x-1">
                {sourceChains
                  .filter((chain) => chain.needsApproval !== false) // Show chains that need approval or are undefined
                  .map((source, index, filteredChains) => {
                    const chainMeta =
                      CHAIN_METADATA[source?.chainId as keyof typeof CHAIN_METADATA];
                    return (
                      <Fragment key={source?.chainId}>
                        <img
                          src={chainMeta?.logo ?? ''}
                          alt={chainMeta?.name}
                          className={cn(
                            'w-6 h-6',
                            index > 0 ? '-ml-5' : '',
                            chainMeta?.id !== SUPPORTED_CHAINS.BASE &&
                              chainMeta?.id !== SUPPORTED_CHAINS.BASE_SEPOLIA
                              ? 'rounded-nexus-full '
                              : '',
                          )}
                          style={{ zIndex: filteredChains.length - index }}
                          title={chainMeta?.name}
                        />
                      </Fragment>
                    );
                  })}
                {sourceChains.filter((chain) => chain.needsApproval !== false).length > 1 && (
                  <span className="font-semibold font-nexus-primary text-base text-nexus-black">
                    +{sourceChains.filter((chain) => chain.needsApproval !== false).length} chains
                  </span>
                )}
              </div>
            </div>
          </div>
          {currentAllowance && (
            <div className="mt-1 py-2 border-b border-nexus-input">
              <div className="flex items-center justify-between text-sm font-nexus-primary">
                <span className="text-xs font-semibold text-nexus-muted font-nexus-primary">
                  Current Allowance
                </span>
                <span className="font-semibold font-nexus-primary text-nexus-black text-base">
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
            <div className=" flex items-center justify-between gap-x-5">
              {/* Minimum Option */}
              <div
                className={cn(
                  'px-4 pt-4 rounded-nexus-md border-2 cursor-pointer transition-all relative h-16 w-full',
                  selectedType === 'minimum'
                    ? 'border-nexus-blue bg-[#0375D81A]'
                    : 'border-nexus-input hover:border-nexus-primary',
                )}
                onClick={() => setSelectedType('minimum')}
              >
                <div className="flex items-center justify-between overflow-clip pt-1">
                  <div className="flex items-center gap-x-3 font-nexus-primary">
                    <input
                      type="radio"
                      checked={selectedType === 'minimum'}
                      onChange={() => setSelectedType('minimum')}
                      className="text-blue-600"
                    />
                    <div className="font-nexus-primary">
                      <span className="text-sm font-bold text-nexus-muted-secondary">Min:</span>
                      <span className="text-base font-bold text-nexus-black ml-2">
                        {formatCost(minimumAmount)}
                      </span>
                    </div>
                  </div>
                  <span className="bg-nexus-blue font-nexus-primary text-white text-[10px] px-2 py-0.5 font-medium absolute top-0 left-0">
                    RECOMMENDED
                  </span>
                </div>
              </div>

              {/* Custom Option */}
              <div
                className={cn(
                  'px-4 pt-4  rounded-nexus-md border-2 cursor-pointer transition-all font-nexus-primary h-16 w-full',
                  selectedType === 'custom'
                    ? 'border-nexus-blue bg-[#0375D81A]'
                    : 'border-nexus-input hover:border-nexus-primary',
                )}
              >
                <div
                  className="flex items-center gap-x-3 pt-1"
                  onClick={() => setSelectedType('custom')}
                >
                  <input
                    type="radio"
                    checked={selectedType === 'custom'}
                    onChange={() => setSelectedType('custom')}
                    className="text-blue-600"
                  />
                  <span className="font-semibold font-nexus-primary text-base text-nexus-black">
                    Custom
                  </span>
                </div>
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
                  <Input
                    placeholder={`Enter amount ≥ ${inputAmount}`}
                    type="string"
                    value={customAmount}
                    disabled={isLoading}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className={cn(
                      'text-nexus-black text-base font-semibold font-nexus-primary leading-normal px-4 py-2 border border-nexus-input rounded-nexus-md',
                      customAmount && !isCustomValid ? 'border-red-500 focus:border-red-500' : '',
                    )}
                  />
                </FormField>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
