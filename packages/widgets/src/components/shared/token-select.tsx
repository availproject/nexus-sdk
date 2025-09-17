import { useMemo } from 'react';
import { TOKEN_METADATA, TESTNET_TOKEN_METADATA } from '@nexus/commons';
import { TokenIcon } from './icons';
import { cn } from '../../utils/utils';
import { Button } from '../motion/button-motion';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { DrawerAutoClose } from '../motion/drawer';
import type { TokenSelectProps } from '../../types';
import { useAvailableTokens, type TokenSelectOption } from '../../utils/token-utils';

export function TokenSelect({
  value,
  onValueChange,
  disabled = false,
  network = 'mainnet',
  className,
  hasValues,
  type,
  chainId,
  isDestination = false,
}: TokenSelectProps & {
  network?: 'mainnet' | 'testnet';
  chainId?: number;
  isDestination?: boolean;
}) {
  const { unifiedBalance, sdk, isSdkInitialized } = useInternalNexus();

  const tokenOptions = useAvailableTokens({
    chainId,
    type: type ?? 'bridge',
    network,
    isDestination,
    sdk: isSdkInitialized ? sdk : undefined,
  });

  // Fallback to legacy logic if no type provided (backward compatibility)
  const legacyTokenOptions: TokenSelectOption[] = useMemo(() => {
    if (type) return []; // Use enhanced logic when type is available

    const tokenMetadata = network === 'testnet' ? TESTNET_TOKEN_METADATA : TOKEN_METADATA;
    return Object.values(tokenMetadata).map((token) => ({
      value: token.symbol,
      label: token.symbol,
      icon: token.icon,
      metadata: {
        ...token,
        contractAddress: undefined, // Legacy mode doesn't have contract addresses
      },
    }));
  }, [network, type]);

  const finalTokenOptions = type ? tokenOptions : legacyTokenOptions;

  const tokenBalanceBreakdown = useMemo(() => {
    let breakdown: Record<string, { bal: string; chains: string }> = {};
    unifiedBalance?.map((balance) => {
      const key = balance?.symbol;
      breakdown[key] = {
        bal: parseFloat(balance?.balance) > 0 ? balance?.balance : '00',
        chains: `${balance?.breakdown?.length > 1 ? balance?.breakdown?.length + ' chains' : balance?.breakdown?.length > 0 ? balance?.breakdown?.length + ' chain' : '-'}`,
      };
    });
    return breakdown;
  }, [unifiedBalance]);

  const selectedOption = useMemo(
    () => finalTokenOptions.find((opt) => opt.value === (value ?? '')),
    [finalTokenOptions, value],
  );

  const handleSelect = (token: string) => {
    if (disabled) return;
    onValueChange(token);
  };

  return (
    <div className={cn('flex flex-col items-start gap-y-4 py-5 pl-4 w-full', className)}>
      <p className="text-nexus-foreground text-lg font-semibold ">
        {type !== 'swap'
          ? 'Destination Token'
          : isDestination
            ? 'Destination Token'
            : 'Source Token'}
      </p>
      <div className="flex flex-col items-start w-full h-full max-h-[332px] overflow-y-scroll gap-y-4">
        {finalTokenOptions.map((token, index) => (
          <DrawerAutoClose key={token?.label} enabled={hasValues}>
            <Button
              variant="custom"
              size="custom"
              onClick={() => handleSelect(token?.value)}
              className={cn(
                'w-full  px-3 py-0.5 rounded-nexus-md hover:bg-nexus-accent-green/10',
                disabled &&
                  'pointer-events-none cursor-not-allowed opacity-50 text-nexus-foreground',
                selectedOption?.value === token?.value ? 'bg-nexus-accent-green/10' : '',
                index === finalTokenOptions.length - 1 && isDestination ? 'mb-20' : '',
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-start gap-x-2">
                  <TokenIcon tokenSymbol={token?.value} iconUrl={token?.icon} />
                  <p className="text-nexus-foreground font-semibold font-nexus-primary text-sm">
                    {token?.label}
                  </p>
                </div>
                {tokenBalanceBreakdown[token?.value]?.bal &&
                  tokenBalanceBreakdown[token?.value]?.chains && (
                    <div className="flex flex-col items-end gap-y-1">
                      <p className="font-semibold font-nexus-primary text-sm text-nexus-foreground">
                        {parseFloat(tokenBalanceBreakdown[token?.value]?.bal).toFixed(6)}
                      </p>
                      <p className="font-semibold font-nexus-primary text-sm text-nexus-secondary ">
                        {tokenBalanceBreakdown[token?.value]?.chains}
                      </p>
                    </div>
                  )}
              </div>
            </Button>
          </DrawerAutoClose>
        ))}

        {/* Empty state */}
        {finalTokenOptions.length === 0 && (
          <div className="flex items-center justify-center w-full py-8">
            <p className="text-nexus-muted text-sm">No tokens available</p>
          </div>
        )}
      </div>
    </div>
  );
}
