import React from 'react';
import { SimulationResult, BridgeAndExecuteSimulationResult } from '../../../types';
import { InfoMessage, Shimmer } from '../shared';

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
    if (!simulationResult || !('intent' in simulationResult)) return null;

    const { intent } = simulationResult;
    return {
      destination: intent.destination as ChainInfo,
      sources: (intent.sources || []) as ChainInfo[],
      fees: intent.fees as FeesInfo,
      token: intent.token as TokenInfo,
      sourcesTotal: intent.sourcesTotal as string,
    };
  };

  const data = getSimulationData();

  if (isLoading || !data) {
    return <LoadingState />;
  }

  return (
    <div className="flex flex-col gap-y-4 w-full">
      {simulationResult?.allowance?.needsApproval && (
        <InfoMessage variant="success" className="px-0">
          You need to set allowance in your wallet first to continue.
        </InfoMessage>
      )}
      <RouteSection data={data} />
      <hr className="border-zinc-400/40" />
      <FeeBreakdown fees={data.fees} tokenSymbol={data.token.symbol} />
    </div>
  );
}

// Loading shimmer component
function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-500 font-primary">Depositing from</span>
        <div className="flex items-center gap-2">
          <Shimmer className="w-6 h-6 rounded-full" />
          <Shimmer className="w-16 h-4 rounded-full" />
        </div>
      </div>
      <hr className="border-zinc-400/40" />
      {/* Fee section loading */}
      <div className="space-y-1">
        <FeeRow label="Gas fees" loading />
        <hr className="border-zinc-400/40" />
        <FeeRow label="Solver fees" loading />
      </div>
    </div>
  );
}

function RouteSection({ data }: { data: SimulationData }) {
  const { sources } = data;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-500 font-primary">Depositing from</span>
        <div className="flex items-center gap-2">
          {/* Source chains */}
          {sources.slice(0, 3).map((source, index) =>
            source.chainLogo ? (
              <img
                key={index}
                src={source.chainLogo}
                alt={source.chainName}
                className={`w-6 h-6 rounded-full ${index > 0 ? '-ml-5' : ''}`}
                style={{ zIndex: sources.length - index }}
              />
            ) : (
              <div
                key={index}
                className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-xs"
              >
                {source.chainName[0]}
              </div>
            ),
          )}
          <span className="text-sm font-semibold text-black font-primary">
            {sources.length} Chain{sources.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

// Fee breakdown component
function FeeBreakdown({ fees, tokenSymbol }: { fees: FeesInfo; tokenSymbol: string }) {
  return (
    <div className="space-y-3">
      <FeeRow label="Gas fees" value={fees.total} tokenSymbol={tokenSymbol} />
      <hr className="border-zinc-400/40" />
      <FeeRow label="Solver fees" value={fees.solver} tokenSymbol={tokenSymbol} />
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
        className={`text-sm font-semibold font-primary ${isTotal ? 'text-black' : 'text-zinc-500'}`}
      >
        {label}
      </span>
      {loading ? (
        <div className="w-16 h-4 bg-gradient-to-r from-gray-200 to-gray-300 rounded animate-pulse" />
      ) : (
        <span
          className={`text-sm font-semibold font-primary ${isTotal ? 'text-black' : 'text-black'}`}
        >
          {value || '0'} {tokenSymbol}
        </span>
      )}
    </div>
  );
}
