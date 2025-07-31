import React from 'react';
import { SimulationResult, BridgeAndExecuteSimulationResult, Intent } from '../../../types';
import { InfoMessage, Shimmer } from '../shared';
import { CHAIN_METADATA, SUPPORTED_CHAINS } from '../../../constants';
import { cn, formatCost } from '../../utils/utils';

interface TransactionSimulationProps {
  isLoading: boolean;
  simulationResult?: (SimulationResult | BridgeAndExecuteSimulationResult) & {
    allowance?: { needsApproval: boolean };
  };
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

export function TransactionSimulation({ isLoading, simulationResult }: TransactionSimulationProps) {
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

  let executeGas: string | undefined;
  if (simulationResult && 'totalEstimatedCost' in simulationResult) {
    executeGas = simulationResult.totalEstimatedCost?.breakdown?.execute;
  }

  if (isLoading || !data) {
    return <LoadingState />;
  }

  return (
    <div className="flex flex-col gap-y-4 w-full mt-6">
      {simulationResult?.allowance?.needsApproval && (
        <InfoMessage variant="success" className="px-0">
          You need to set allowance in your wallet first to continue.
        </InfoMessage>
      )}
      <RouteSection data={data} />
      <hr className="border-zinc-400/40" />
      <FeeBreakdown fees={data?.fees} tokenSymbol={data?.token?.symbol} executeGas={executeGas} />
    </div>
  );
}

// Loading shimmer component
function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-500 font-nexus-primary">
          Depositing from
        </span>
        <div className="flex items-center gap-2">
          <Shimmer className="w-6 h-6 rounded-nexus-full" />
          <Shimmer className="w-16 h-4 rounded-nexus-full" />
        </div>
      </div>
      <hr className="border-zinc-400/40" />
      <FeeRow label="Gas fees" loading />
      <hr className="border-zinc-400/40" />
      <FeeRow label="Solver fees" loading />
    </div>
  );
}

function RouteSection({ data }: { data: SimulationData }) {
  const { sources } = data;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-500 font-nexus-primary">
          Depositing from
        </span>
        <div className="flex items-center gap-2">
          {/* Source chains */}
          {sources.slice(0, 3).map((source, index) =>
            source.chainID ? (
              <img
                key={index}
                src={CHAIN_METADATA[source?.chainID]?.logo}
                alt={source.chainName}
                className={cn(
                  'w-6 h-6',
                  index > 0 ? '-ml-5' : '',
                  source?.chainID !== SUPPORTED_CHAINS.BASE &&
                    source?.chainID !== SUPPORTED_CHAINS.BASE_SEPOLIA
                    ? 'rounded-nexus-full'
                    : '',
                )}
                style={{ zIndex: sources.length - index }}
              />
            ) : (
              <div
                key={index}
                className="w-6 h-6 rounded-nexus-full bg-gray-300 flex items-center justify-center text-xs"
              >
                {source?.chainName[0]}
              </div>
            ),
          )}
          <span className="text-sm font-semibold text-black font-nexus-primary">
            {sources?.length} Chain{sources?.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

// Fee breakdown component
function FeeBreakdown({
  fees,
  tokenSymbol,
  executeGas,
}: {
  fees: FeesInfo;
  tokenSymbol: string;
  executeGas?: string;
}) {
  return (
    <div className="space-y-3">
      {parseFloat(fees.total) > 0 && (
        <>
          <FeeRow label="Transaction gas" value={fees.total} tokenSymbol={tokenSymbol} />
          <hr className="border-zinc-400/40" />
        </>
      )}

      {executeGas && <FeeRow label="Execute gas" value={executeGas} tokenSymbol={tokenSymbol} />}
      {parseFloat(fees.solver) > 0 && (
        <>
          {executeGas && <hr className="border-zinc-400/40" />}

          <FeeRow label="Solver fees" value={fees.solver} tokenSymbol={tokenSymbol} />
        </>
      )}
    </div>
  );
}

// Individual fee row component
function FeeRow({
  label,
  value,
  loading = false,
  isTotal = false,
  tokenSymbol,
}: {
  label: string;
  value?: string;
  loading?: boolean;
  isTotal?: boolean;
  tokenSymbol?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span
        className={`text-sm font-semibold font-nexus-primary ${isTotal ? 'text-black' : 'text-zinc-500'}`}
      >
        {label}
      </span>
      {loading ? (
        <Shimmer className="w-16 h-4 rounded-nexus-full" />
      ) : (
        <span
          className={`text-sm font-semibold font-nexus-primary ${isTotal ? 'text-black' : 'text-black'}`}
        >
          {formatCost(value ?? '')} {tokenSymbol}
        </span>
      )}
    </div>
  );
}
