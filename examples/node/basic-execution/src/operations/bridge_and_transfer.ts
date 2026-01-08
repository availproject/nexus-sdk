import { NEXUS_EVENTS, NexusSDK, TransferParams } from '@avail-project/nexus-core';
import { Logger, stringifyError } from '../logger';

// return true if it was successful
export async function bridgeAndTransfer(
  id: string,
  params: TransferParams,
  sdk: NexusSDK,
): Promise<boolean> {
  Logger.info(id, { message: 'New Bridge And Transfer call started' });

  try {
    const result = await sdk.bridgeAndTransfer(params, {
      onEvent: (event) => {
        if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
          Logger.info(id, { message: 'Step Completed', data: event.args });
        }
      },
    });

    Logger.info(id, {
      message: 'Bridge and Transfer call success',
      data: result,
    });
    return true;
  } catch (e: any) {
    Logger.error(id, {
      message: 'Bridge and Transfer call failed',
      reason: stringifyError(e),
    });
    return false;
  }
}
