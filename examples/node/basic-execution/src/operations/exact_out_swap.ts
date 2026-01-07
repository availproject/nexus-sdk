import { NEXUS_EVENTS, NexusSDK, ExactOutSwapInput } from '@avail-project/nexus-core';
import { Logger, stringifyError } from '../logger';

// return true if it was successful
export async function exactOutSwap(
  id: string,
  params: ExactOutSwapInput,
  sdk: NexusSDK,
): Promise<boolean> {
  Logger.info(id, { message: 'New Exact Out Swap call started' });

  try {
    const result = await sdk.swapWithExactOut(params, {
      onEvent: (event) => {
        if (event.name === NEXUS_EVENTS.SWAP_STEP_COMPLETE) {
          Logger.info(id, { message: 'Step Completed', data: event.args });
        }
      },
    });

    Logger.info(id, { message: 'Exact Out Swap call success', data: result });
    return true;
  } catch (e: any) {
    Logger.error(id, {
      message: 'Exact Out Swap failed',
      reason: stringifyError(e),
    });
    return false;
  }
}
