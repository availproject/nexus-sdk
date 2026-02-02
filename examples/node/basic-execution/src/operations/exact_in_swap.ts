import { NEXUS_EVENTS, NexusSDK, ExactInSwapInput } from '@avail-project/nexus-core';
import { Logger, stringifyError } from '../logger';

// return true if it was successful
export async function exactInSwap(
  id: string,
  params: ExactInSwapInput,
  sdk: NexusSDK,
): Promise<boolean> {
  Logger.info(id, { message: 'New Exact In Swap call started' });

  try {
    const result = await sdk.swapWithExactIn(params, {
      onEvent: (event) => {
        if (event.name === NEXUS_EVENTS.SWAP_STEP_COMPLETE) {
          Logger.info(id, { message: 'Step Completed', data: event.args });
        }
      },
    });

    Logger.info(id, { message: 'Exact In Swap call success', data: result });
    return true;
  } catch (e: any) {
    Logger.error(id, {
      message: 'Exact In Swap failed',
      reason: stringifyError(e),
    });
    return false;
  }
}
