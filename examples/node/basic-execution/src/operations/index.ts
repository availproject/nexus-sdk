import { NexusSDK } from '@avail-project/nexus-core';
import { bridge } from './bridge';
import { bridgeAndTransfer } from './bridge_and_transfer';
import { bridgeAndExecute } from './bridge_and_execute';
import { exactInSwap } from './exact_in_swap';
import { exactOutSwap } from './exact_out_swap';
import { Logger } from '../logger';

export async function executeOperation(
  id: string,
  operation: string,
  params: any,
  sdk: NexusSDK,
): Promise<boolean> {
  if (operation.toLowerCase() == 'bridge') {
    return await bridge(id, params, sdk);
  }

  if (operation.toLowerCase() == 'bridgeAndTransfer'.toLowerCase()) {
    return await bridgeAndTransfer(id, params, sdk);
  }

  if (operation.toLowerCase() == 'bridgeAndExecute'.toLowerCase()) {
    return await bridgeAndExecute(id, params, sdk);
  }

  if (operation.toLowerCase() == 'exactInSwap'.toLowerCase()) {
    return await exactInSwap(id, params, sdk);
  }

  if (operation.toLowerCase() == 'exactOutSwap'.toLowerCase()) {
    return await exactOutSwap(id, params, sdk);
  }

  Logger.error(id, {
    message: `Unknown operation ${operation}. Supported operations: bridge, bridgeAndTransfer, bridgeAndExecute, exactInSwap, exactOutSwap`,
  });

  return false;
}
