import type { Hex } from 'viem';
import { type ChainListType, SWAP_STEPS, type SwapStepType } from '../commons';
import { Errors } from '../core/errors';
import type { SwapRoute } from './route';
import { isNativeAddress } from './utils';

// Hash steps embed an explorer URL built from a real tx hash. The expected list is published
// before any tx is sent, so a placeholder is used — consumers match real STEP_COMPLETE events
// by typeID (which is chain-derived, not hash-derived) and replace the placeholder entry.
const PLACEHOLDER_HASH: Hex = '0x0';

const executionModeToStepMode = (mode: '7702' | 'safe_account'): 'safe' | 'calibur' =>
  mode === 'safe_account' ? 'safe' : 'calibur';

export const createSwapSteps = (
  route: SwapRoute,
  chainList: ChainListType,
  cotSymbol: string
): SwapStepType[] => {
  const steps: SwapStepType[] = [SWAP_STEPS.SWAP_START, SWAP_STEPS.DETERMINING_SWAP(true)];

  // Destination-side EOA → wrapper COT permit/transferFrom for any pre-existing dst-chain COT.
  // Built at the START of the flow (flows/swap.ts) — non-combined: by dstSwapHandler.createPermit();
  // combined: inlined into CombinedSwapHandler.buildBatch. Always listed when present so the UI
  // can show progress for the permit-creation work (which used to fire silently).
  if (route.destination.eoaToDestinationAccount) {
    const dstChain = chainList.getChainByID(route.destination.chainId);
    if (!dstChain) {
      throw Errors.chainNotFound(route.destination.chainId);
    }
    steps.push(SWAP_STEPS.CREATE_PERMIT_EOA_TO_EPHEMERAL(false, cotSymbol, dstChain));
  }

  if (route.combined) {
    // CombinedSwapHandler batches source + destination + sweep into one tx and emits
    // SOURCE_SWAP_HASH, DESTINATION_SWAP_HASH, DESTINATION_SWAP_BATCH_TX(true), SWAP_COMPLETE.
    // Source permits are folded into the batch and not emitted individually.
    const chain = chainList.getChainByID(route.destination.chainId);
    if (!chain) {
      throw Errors.chainNotFound(route.destination.chainId);
    }

    // EOA execTransaction for combined fires only when the batch carries native value
    // (CombinedSwapHandler.submitBatch routes the no-native case through the VSC relay).
    const hasNativeSourceInput = route.source.swaps.some((swap) =>
      isNativeAddress(swap.quote.input.contractAddress)
    );
    if (hasNativeSourceInput && route.destination.execution.mode !== 'direct_eoa') {
      steps.push(
        SWAP_STEPS.EOA_EXECUTE_CALL(
          false,
          chain,
          executionModeToStepMode(route.destination.execution.mode)
        )
      );
    }

    steps.push(
      SWAP_STEPS.SOURCE_SWAP_HASH([BigInt(chain.id), PLACEHOLDER_HASH], chainList),
      SWAP_STEPS.DESTINATION_SWAP_HASH([BigInt(chain.id), PLACEHOLDER_HASH], chainList),
      SWAP_STEPS.DESTINATION_SWAP_BATCH_TX(true),
      SWAP_STEPS.SWAP_COMPLETE
    );
    return steps;
  }

  // Source-side: permit-per-ERC20-input, EOA execTransaction per chain with native value, then
  // one hash per source chain. The EOA execTransaction only fires when SourceSwapsHandler has
  // native value to send (sbcCalls.value > 0n); the no-native case goes through the VSC relay
  // and emits no EOA_EXECUTE_CALL.
  const sourceChainIDs = new Set<number>();
  const chainHasNativeInput = new Map<number, boolean>();
  for (const swap of route.source.swaps) {
    const chainID = Number(swap.chainID);
    sourceChainIDs.add(chainID);
    if (isNativeAddress(swap.quote.input.contractAddress)) {
      chainHasNativeInput.set(chainID, true);
    } else {
      const chain = chainList.getChainByID(chainID);
      if (!chain) {
        throw Errors.chainNotFound(chainID);
      }
      steps.push(SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(false, swap.quote.input.symbol, chain));
    }
  }
  for (const chainID of sourceChainIDs) {
    if (chainHasNativeInput.get(chainID)) {
      const chain = chainList.getChainByID(chainID);
      if (!chain) {
        throw Errors.chainNotFound(chainID);
      }
      const execution = route.source.executions[chainID];
      if (execution) {
        steps.push(
          SWAP_STEPS.EOA_EXECUTE_CALL(false, chain, executionModeToStepMode(execution.mode))
        );
      }
    }
    steps.push(SWAP_STEPS.SOURCE_SWAP_HASH([BigInt(chainID), PLACEHOLDER_HASH], chainList));
  }

  // Bridge-side: one BRIDGE_DEPOSIT per source-asset chain that needs a deposit, then RFF_ID.
  // Bridge assets with a positive EOA balance also need an EOA→ephemeral COT permit before
  // deposit (see BridgeHandler.createRFFDeposits — matches the rff.ts branch that sets
  // eoaToEphemeralCalls when asset.eoaBalance > 0).
  if (route.bridge) {
    const depositChainIDs = new Set<number>();
    for (const asset of route.bridge.assets) {
      depositChainIDs.add(asset.chainID);
      if (asset.eoaBalance.gt(0)) {
        const chain = chainList.getChainByID(asset.chainID);
        if (!chain) {
          throw Errors.chainNotFound(asset.chainID);
        }
        steps.push(SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(false, cotSymbol, chain));
      }
    }
    for (const chainID of depositChainIDs) {
      const chain = chainList.getChainByID(chainID);
      if (!chain) {
        throw Errors.chainNotFound(chainID);
      }
      steps.push(
        SWAP_STEPS.BRIDGE_DEPOSIT({
          chain,
          hash: PLACEHOLDER_HASH,
          explorerURL: chain.blockExplorers.default.url,
        })
      );
    }
    steps.push(SWAP_STEPS.RFF_ID(0));
  }

  // Destination-side.
  if (route.destination.execution.mode === 'direct_eoa') {
    steps.push(SWAP_STEPS.SWAP_COMPLETE);
    return steps;
  }

  const dstSwap = route.destination.swap;
  const hasDestinationSwap = !!(dstSwap.tokenSwap || dstSwap.gasSwap);
  if (hasDestinationSwap) {
    steps.push(
      SWAP_STEPS.DESTINATION_SWAP_BATCH_TX(false),
      SWAP_STEPS.DESTINATION_SWAP_HASH(
        [BigInt(route.destination.chainId), PLACEHOLDER_HASH],
        chainList
      )
    );
  }
  steps.push(SWAP_STEPS.DESTINATION_SWAP_BATCH_TX(true), SWAP_STEPS.SWAP_COMPLETE);

  return steps;
};
