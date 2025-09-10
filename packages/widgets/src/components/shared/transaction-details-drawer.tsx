import {
  type SimulationResult,
  type BridgeAndExecuteSimulationResult,
  type ReadableIntent as Intent,
  CHAIN_METADATA,
  SUPPORTED_CHAINS,
} from '@nexus/commons';
import { SwapSimulationResult } from '../../types';
import { cn, formatCost, getPrimaryButtonText, truncateAddress } from '../../utils/utils';
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
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { getFiatValue } from '../../utils/balance-utils';
import type { OrchestratorStatus, ReviewStatus, TransactionType } from '../../types';

interface TransactionDetailsDrawerProps {
  simulationResult?: (
    | SimulationResult
    | BridgeAndExecuteSimulationResult
    | SwapSimulationResult
  ) & {
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
  type?: TransactionType;
  status: OrchestratorStatus;
  reviewStatus: ReviewStatus;
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
  contractAddress?: string;
  functionName?: string;
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
  type,
  status,
  reviewStatus,
}: TransactionDetailsDrawerProps) {
  const { exchangeRates } = useInternalNexus();
  const getSimulationData = (): SimulationData | null => {
    if (!simulationResult) return null;

    // Handle swap simulation result
    if ('swapMetadata' in simulationResult) {
      const swapSim = simulationResult as SwapSimulationResult;
      const intent = swapSim.intent;
      if (!intent) return null;
      const destinationChain = CHAIN_METADATA[intent?.destination?.chain.id];
      const sources = intent.sources.map((source) => {
        const sourceChain = CHAIN_METADATA[source.chain.id];
        return {
          chainID: sourceChain?.id,
          chainName: sourceChain?.name || 'Unknown',
          chainLogo: sourceChain?.logo,
          amount: source.amount,
        } as ChainInfo;
      });

      return {
        destination: {
          chainID: destinationChain?.id,
          chainName: destinationChain?.name || 'Unknown',
          chainLogo: destinationChain?.logo,
          amount: swapSim?.intent?.destination?.amount,
        } as ChainInfo,
        sources,
        fees: {
          total: '0', // Swap fees are typically handled differently
          caGas: '0',
          gasSupplied: '0',
          protocol: '0',
          solver: '0',
        } as FeesInfo,
        token: {
          symbol: intent?.sources?.[0]?.token?.symbol || 'Unknown',
          name: intent?.sources?.[0]?.token?.symbol,
          decimals: intent?.sources?.[0]?.token?.decimals,
        } as TokenInfo,
        sourcesTotal: intent.sources?.[0]?.amount || '0',
      };
    }

    // Check if bridge was skipped in bridge & execute flow
    if (
      'metadata' in simulationResult &&
      (simulationResult as BridgeAndExecuteSimulationResult)?.metadata?.bridgeSkipped
    ) {
      const simulation = simulationResult as BridgeAndExecuteSimulationResult;
      const metadata = simulation?.metadata;

      if (!metadata) return null;

      return {
        contractAddress: metadata?.contractAddress ?? '',
        functionName: metadata?.functionName ?? '',
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
          total: simulation?.executeSimulation?.gasUsed ?? '0',
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
      const simulation = simulationResult as BridgeAndExecuteSimulationResult;
      intent = simulation?.bridgeSimulation?.intent;
      const fees = {
        total: simulation?.totalEstimatedCost?.total ?? '0',
        ...simulation?.bridgeSimulation?.intent?.fees,
      } as FeesInfo;

      return {
        contractAddress: simulation?.executeSimulation?.contractAddress ?? '',
        functionName: simulation?.executeSimulation?.functionName ?? '',
        destination: intent?.destination as ChainInfo,
        sources: (intent?.sources || []) as ChainInfo[],
        fees: fees,
        token: intent?.token as TokenInfo,
        sourcesTotal: intent?.sourcesTotal as string,
      };
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

        <div className="space-y-2 px-4">
          {/* Estimated Time */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-x-1">
              <Clock />
              <p className="text-nexus-muted-secondary text-sm font-semibold font-nexus-primary">
                Estimated Transaction time
              </p>
            </div>
            <span className="text-nexus-black text-sm font-semibold font-nexus-primary">
              ~{type === 'bridgeAndExecute' ? '1.5 mins' : '30 seconds'}
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

          {/* Contract Address */}
          {data?.contractAddress && data?.functionName && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-x-1">
                <TwoCircles />
                <p className="text-nexus-muted-secondary text-sm font-semibold font-nexus-primary capitalize">
                  {data?.functionName} to
                </p>
              </div>
              <span className="text-nexus-black text-sm font-semibold font-nexus-primary">
                {truncateAddress(data?.contractAddress, 4, 4)}
              </span>
            </div>
          )}

          {/* Sending */}
          <div className="flex items-center justify-between pb-1 border-b border-nexus-muted-secondary/20">
            <div className="flex items-center gap-x-1">
              <MoneyCircles />
              <p className="text-nexus-muted-secondary text-sm font-semibold font-nexus-primary">
                Sending
              </p>
            </div>
            <div className="flex items-center gap-x-2">
              <div className="flex flex-col items-end">
                <p className="text-base font-semibold text-nexus-foreground font-nexus-primary">
                  {inputData?.amount || data.sourcesTotal} {inputData?.token || data.token.symbol}
                </p>
                {inputData?.token && (
                  <p className="text-nexus-accent-green font-semibold font-nexus-primary text-xs">
                    {getFiatValue(data.sourcesTotal, inputData?.token, exchangeRates)}
                  </p>
                )}
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
                            '',
                            source.chainID !== SUPPORTED_CHAINS.BASE &&
                              source.chainID !== SUPPORTED_CHAINS.BASE_SEPOLIA
                              ? 'rounded-full w-8 h-8'
                              : 'w-6 h-6',
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
                          {inputData?.token &&
                            getFiatValue(source.amount, inputData?.token, exchangeRates)}
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
              {getPrimaryButtonText(status, reviewStatus)}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
