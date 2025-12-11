import {
  type MsgCreateRequestForFunds,
  MsgCreateRequestForFundsResponse,
  type MsgDoubleCheckTx,
  MsgRefundReq,
  MsgRefundReqResponse,
} from '@avail-project/ca-common';
import { isDeliverTxFailure, isDeliverTxSuccess } from '@cosmjs/stargate';
import type Long from 'long';
import {
  type CosmosOptions,
  type CosmosQueryClient,
  getLogger,
  type VSCClient,
} from '../../../commons';
import { Errors } from '../errors';

const logger = getLogger();

const cosmosFeeGrant = async (
  address: string,
  cosmosClient: CosmosQueryClient,
  vscClient: VSCClient
) => {
  try {
    await cosmosClient.getAccount(address);
  } catch (e) {
    logger.error('Requesting a fee grant', e, { cause: 'FEE_GRANT_REQUESTED' });
    const response = await vscClient.vscCreateFeeGrant(address);
    logger.debug('Fee grant response', response);
    return;
  }
};

const cosmosFillCheck = async (
  intentID: Long,
  cosmosClient: CosmosQueryClient,
  ac: AbortController
) => {
  return Promise.any([
    cosmosClient.waitForCosmosFillEvent(intentID, ac),
    cosmosClient.checkIntentFilled(intentID),
  ]);
};

const cosmosCreateRFF = async ({
  address,
  client,
  msg,
}: CosmosOptions & {
  msg: MsgCreateRequestForFunds;
}) => {
  try {
    const res = await client.signAndBroadcast(
      address,
      [
        {
          typeUrl: '/xarchain.chainabstraction.MsgCreateRequestForFunds',
          value: msg,
        },
      ],
      {
        amount: [],
        gas: 100_000n.toString(10),
      }
    );

    if (isDeliverTxFailure(res)) {
      throw Errors.cosmosError(`Error creating RFF – code=${res.code} log=${res.rawLog ?? 'n/a'}`);
    }

    const decoded = MsgCreateRequestForFundsResponse.decode(res.msgResponses[0].value);
    return decoded.id;
  } finally {
    client.disconnect();
  }
};
const cosmosRefundIntent = async ({
  address,
  client,
  intentID,
}: CosmosOptions & {
  intentID: number;
}) => {
  try {
    const resp = await client.signAndBroadcast(
      address,
      [
        {
          typeUrl: '/xarchain.chainabstraction.MsgRefundReq',
          value: MsgRefundReq.create({
            creator: address,
            rffID: intentID,
          }),
        },
      ],
      {
        amount: [],
        gas: 200_000n.toString(10),
      }
    );
    logger.debug('Refund response', { resp });
    try {
      if (isDeliverTxSuccess(resp)) {
        const decoded = MsgRefundReqResponse.decode(resp.msgResponses[0].value);
        logger.debug('Refund success', { decoded, resp });
        return resp;
      } else if (resp.code === 18) {
        if (
          resp.rawLog?.includes('RFF already refunded') ||
          resp.rawLog?.includes('RFF already filled')
        ) {
          return resp;
        }
        throw Errors.cosmosError('RFF is not expired yet.');
      } else {
        throw Errors.cosmosError(`unknown error: ${JSON.stringify(resp)}`);
      }
    } catch (e) {
      logger.error('Refund failed', e, { cause: 'REFUND_FAILED' });
      throw e;
    }
  } finally {
    client.disconnect();
  }
};
const cosmosCreateDoubleCheckTx = async ({
  address,
  client,
  msg,
}: CosmosOptions & {
  msg: MsgDoubleCheckTx;
}) => {
  try {
    logger.debug('cosmosCreateDoubleCheckTx', { doubleCheckMsg: msg });

    const res = await client.signAndBroadcast(
      address,
      [
        {
          typeUrl: '/xarchain.chainabstraction.MsgDoubleCheckTx',
          value: msg,
        },
      ],
      {
        amount: [],
        gas: 100_000n.toString(10),
      }
    );

    if (isDeliverTxFailure(res)) {
      throw Errors.cosmosError('double check tx failed');
    }

    logger.debug('double check response', { doubleCheckTx: res });
  } finally {
    client.disconnect();
  }
};

export {
  cosmosFeeGrant,
  cosmosFillCheck,
  cosmosCreateDoubleCheckTx,
  cosmosRefundIntent,
  cosmosCreateRFF,
};
