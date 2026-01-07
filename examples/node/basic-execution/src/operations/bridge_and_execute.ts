import { BridgeAndExecuteParams, NEXUS_EVENTS, NexusSDK } from '@avail-project/nexus-core';
import { Logger, stringifyError } from '../logger';

// return true if it was successful
export async function bridgeAndExecute(
  id: string,
  params: BridgeAndExecuteParams,
  sdk: NexusSDK,
): Promise<boolean> {
  Logger.info(id, { message: 'New Bridge and Execute call started' });

  try {
    const result = await sdk.bridgeAndExecute(params, {
      onEvent: (event) => {
        if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
          Logger.info(id, { message: 'Step Completed', data: event.args });
        }
      },
    });

    Logger.info(id, {
      message: 'Bridge and Execute call success',
      data: result,
    });
    return true;
  } catch (e: any) {
    Logger.error(id, {
      message: 'Bridge and Execute call failed',
      reason: stringifyError(e),
    });
    return false;
  }
}
