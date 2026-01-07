import { BridgeParams, NEXUS_EVENTS, NexusSDK } from '@avail-project/nexus-core';
import { Logger, stringifyError } from '../logger';

// return true if it was successful
export async function bridge(id: string, params: BridgeParams, sdk: NexusSDK): Promise<boolean> {
  Logger.info(id, { message: 'New Bridge call started' });

  try {
    const result = await sdk.bridge(params, {
      onEvent: (event) => {
        if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
          Logger.info(id, { message: 'Step Completed', data: event.args });
        }
      },
    });

    Logger.info(id, { message: 'Bridge call success', data: result });
    return true;
  } catch (e: any) {
    Logger.error(id, {
      message: 'Bridge call failed',
      reason: stringifyError(e),
    });
    return false;
  }
}
