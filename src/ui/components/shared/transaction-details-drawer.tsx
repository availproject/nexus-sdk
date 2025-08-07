import React from 'react';
import { SimulationResult, BridgeAndExecuteSimulationResult, Intent } from '../../../types';
import { CHAIN_METADATA, SUPPORTED_CHAINS } from '../../../constants';
import { cn, formatCost } from '../../utils/utils';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
  DrawerFooter,
} from '../motion/drawer';
import { CircleX } from '../icons';
import Clock from '../icons/Clock';
import TwoCircles from '../icons/TwoCircles';
import MoneyCircles from '../icons/MoneyCircles';
import { Button } from '../motion/button-motion';

interface TransactionDetailsDrawerProps {
  simulationResult?: (SimulationResult | BridgeAndExecuteSimulationResult) & {
    allowance?: { needsApproval: boolean };
  };
  inputData?: {
    token?: string;
    amount?: string | number;
    chainId?: number;
    toChainId?: number;
  };
  callback: () => void;
  triggerClassname?: string;
}

interface ChainInfo {
  amount: string;
  chainID: number;
  chainLogo?: string;
  chainName: string;
  contractAddress?: string;
}

interface FeesInfo {
  caGas: string;
  gasSupplied: string;
  protocol: string;
  solver: string;
  total: string;
}

interface TokenInfo {
  decimals: number;
  logo?: string;
  name: string;
  symbol: string;
}

interface SimulationData {
  destination: ChainInfo;
  sources: ChainInfo[];
  fees: FeesInfo;
  token: TokenInfo;
  sourcesTotal: string;
}

export function TransactionDetailsDrawer({
  simulationResult,
  inputData,
  callback,
  triggerClassname = '',
}: TransactionDetailsDrawerProps) {
  const getSimulationData = (): SimulationData | null => {
    if (!simulationResult) return null;

    // Check if bridge was skipped in bridge & execute flow
    if (
      'metadata' in simulationResult &&
      (simulationResult as BridgeAndExecuteSimulationResult)?.metadata?.bridgeSkipped
    ) {
      const metadata = (simulationResult as BridgeAndExecuteSimulationResult)?.metadata;

      if (!metadata) return null;

      return {
        destination: {
          chainID: metadata?.targetChain,
          chainName: CHAIN_METADATA[metadata?.targetChain]?.name || 'Unknown',
          chainLogo: CHAIN_METADATA[metadata?.targetChain]?.logo,
          amount: metadata?.inputAmount,
        } as ChainInfo,
        sources: [
          {
            chainName: CHAIN_METADATA[metadata?.targetChain]?.name,
            chainID: metadata?.targetChain,
            chainLogo: CHAIN_METADATA[metadata?.targetChain]?.logo,
            amount: metadata?.inputAmount,
          },
        ],
        fees: {
          total: '0',
          bridge: '0',
          caGas: '0',
          gasSupplied: '0',
          protocol: '0',
          solver: '0',
        } as FeesInfo,
        token: { name: simulationResult?.metadata?.token || 'Unknown' } as TokenInfo,
        sourcesTotal: metadata?.inputAmount || '0',
      };
    }

    // Handle bridge & execute result where intent is nested
    let intent: Intent | undefined = undefined;
    if ('intent' in simulationResult) {
      intent = (simulationResult as SimulationResult)?.intent;
    } else if ('bridgeSimulation' in simulationResult && simulationResult?.bridgeSimulation) {
      intent = (simulationResult?.bridgeSimulation as SimulationResult)?.intent;
    }

    if (!intent) return null;

    return {
      destination: intent?.destination as ChainInfo,
      sources: (intent?.sources || []) as ChainInfo[],
      fees: intent?.fees as FeesInfo,
      token: intent?.token as TokenInfo,
      sourcesTotal: intent?.sourcesTotal as string,
    };
  };

  const data = getSimulationData();

  const getDestinationChain = () => {
    if (inputData?.toChainId) return inputData.toChainId;
    if (inputData?.chainId) return inputData.chainId;
    return data?.destination?.chainID;
  };

  const destinationChainId = getDestinationChain();
  const destinationChain = destinationChainId ? CHAIN_METADATA[destinationChainId] : null;

  if (!data) return null;

  return (
    <Drawer>
      <DrawerTrigger
        className={cn(
          'text-sm font-nexus-primary font-semibold text-nexus-muted-foreground underline underline-offset-3 hover:text-nexus-foreground transition-colors cursor-pointer',
          triggerClassname,
        )}
      >
        View Full Transaction Details
      </DrawerTrigger>

      <DrawerContent className="no-scrollbar">
        <DrawerHeader className="flex-row items-center justify-between px-4 py-6">
          <DrawerTitle>Transaction Details</DrawerTitle>
          <DrawerClose>
            <CircleX className="w-6 h-6 text-nexus-black hover:text-zinc-700 transition-colors" />
          </DrawerClose>
        </DrawerHeader>

        <div className="space-y-2.5 px-4">
          {/* Estimated Time */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-x-1">
              <Clock />
              <p className="text-nexus-muted-secondary text-sm font-semibold font-nexus-primary">
                Estimated Swap time
              </p>
            </div>
            <span className="text-nexus-black text-sm font-semibold font-nexus-primary">
              ~2 min
            </span>
          </div>

          {/* Total Fees */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-x-1">
              <TwoCircles />
              <p className="text-nexus-muted-secondary text-sm font-semibold font-nexus-primary">
                Total Fees
              </p>
            </div>
            <span className="text-nexus-black text-sm font-semibold font-nexus-primary">
              {formatCost(data.fees.total)} {inputData?.token || data.token.symbol}
            </span>
          </div>

          {/* Sending */}
          <div className="flex items-center justify-between pb-4 border-b border-nexus-muted-secondary/20">
            <div className="flex items-center gap-x-1">
              <MoneyCircles />
              <p className="text-nexus-muted-secondary text-sm font-semibold font-nexus-primary">
                Sending
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-x-2">
                <div className="flex flex-col items-end gap-y-2">
                  <p className="text-base font-semibold text-nexus-foreground font-nexus-primary">
                    {inputData?.amount || data.sourcesTotal} {inputData?.token || data.token.symbol}
                  </p>
                  <p className="text-nexus-accent-green font-semibold font-nexus-primary text-xs leading-0">
                    ≈ $
                    {(
                      parseFloat(inputData?.amount?.toString() || data.sourcesTotal) * 2948
                    ).toFixed(0)}
                  </p>
                </div>
                {destinationChain && (
                  <>
                    <p className="text-nexus-muted-secondary font-semibold text-sm">on</p>
                    <img
                      src={destinationChain.logo}
                      alt={destinationChain.name}
                      className={cn(
                        'w-5 h-5',
                        destinationChainId !== SUPPORTED_CHAINS.BASE &&
                          destinationChainId !== SUPPORTED_CHAINS.BASE_SEPOLIA
                          ? 'rounded-full'
                          : '',
                      )}
                    />
                    <span className="text-nexus-foreground font-semibold text-sm uppercase">
                      {destinationChain.name}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* From Section */}
          {data.sources.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-nexus-black mb-2.5">From</h3>
              <div className="space-y-2.5">
                {data.sources.map((source, index) => {
                  const chainMeta = CHAIN_METADATA[source.chainID];
                  return (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center gap-x-2">
                        <img
                          src={chainMeta?.logo}
                          alt={chainMeta?.name || 'Chain'}
                          className={cn(
                            'w-8 h-8',
                            source.chainID !== SUPPORTED_CHAINS.BASE &&
                              source.chainID !== SUPPORTED_CHAINS.BASE_SEPOLIA
                              ? 'rounded-full'
                              : '',
                          )}
                        />
                        <div className="flex flex-col items-start gap-y-1">
                          <div className="text-sm text-nexus-muted-foreground font-semibold uppercase">
                            {inputData?.token || data.token.symbol}
                          </div>
                          <div className="text-xs text-nexus-muted-foreground font-semibold">
                            on {chainMeta?.name || 'Unknown Chain'}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-y-1">
                        <div className="text-nexus-foreground font-nexus-primary text-sm font-semibold text-right">
                          {source.amount}
                        </div>
                        <div className="text-xs font-semibold text-nexus-muted-secondary text-right">
                          ≈ ${(parseFloat(source.amount) * 2948).toFixed(0)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <DrawerFooter className="border-t border-nexus-muted-secondary/20 px-4 py-2 mt-6">
          <DrawerClose className="w-full">
            <Button onClick={callback} className="px-4 w-full font-nexus-primary min-h-12">
              Start Transaction
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
