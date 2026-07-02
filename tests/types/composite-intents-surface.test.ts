import type {
  AvailableBalances,
  BridgeAndExecuteIntent,
  BridgeAndExecuteOnIntentHookData,
  BridgeIntent,
  ExecuteRequirement,
  NexusClient,
  Shortfall,
  SwapAndExecuteIntent,
  SwapAndExecuteOnIntentHookData,
  SwapExecuteParams,
} from '../../src';

declare const executeRequirement: ExecuteRequirement;
declare const availableBalances: AvailableBalances;
declare const shortfall: Shortfall;
declare const bridgeIntent: BridgeAndExecuteIntent;
declare const bridgeHookData: BridgeAndExecuteOnIntentHookData;
declare const swapIntent: SwapAndExecuteIntent;
declare const swapHookData: SwapAndExecuteOnIntentHookData;
declare const bridgeReadableIntent: BridgeIntent;
declare const swapExecuteParams: SwapExecuteParams;
declare const bridgeAndExecuteOptions: NonNullable<Parameters<NexusClient['bridgeAndExecute']>[1]>;
declare const swapAndExecuteOptions: NonNullable<Parameters<NexusClient['swapAndExecute']>[1]>;

executeRequirement.token.value satisfies string;
executeRequirement.gas.estimatedGasUnits satisfies string;
availableBalances.gas.value satisfies string;
shortfall.token.amountRaw satisfies bigint;
bridgeHookData.intent satisfies BridgeAndExecuteIntent;
swapHookData.intent satisfies SwapAndExecuteIntent;
swapExecuteParams.gasPrice satisfies 'low' | 'medium' | 'high' | undefined;
bridgeAndExecuteOptions.onIntent satisfies
  | ((data: BridgeAndExecuteOnIntentHookData) => void)
  | undefined;
swapAndExecuteOptions.onIntent satisfies
  | ((data: SwapAndExecuteOnIntentHookData) => void)
  | undefined;
bridgeReadableIntent.selectedSources[0]?.value satisfies string | undefined;
bridgeReadableIntent.availableSources[0]?.value satisfies string | undefined;
bridgeReadableIntent.destination.value satisfies string;
bridgeReadableIntent.sourcesTotalValue satisfies string;
bridgeReadableIntent.fees.totalValue satisfies string;

// @ts-expect-error bridgeAndExecute no longer accepts nested hooks
bridgeAndExecuteOptions.hooks;

// @ts-expect-error swapAndExecute no longer accepts nested hooks
swapAndExecuteOptions.hooks;

if (bridgeIntent.bridgeRequired) {
  bridgeIntent.bridge satisfies BridgeIntent;
  bridgeIntent.shortfall satisfies Shortfall;
}

if (swapIntent.swapRequired) {
  void swapHookData.refresh([]);
  swapIntent.shortfall satisfies Shortfall;
}
