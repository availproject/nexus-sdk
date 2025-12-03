import {
  MsgCreatePendingClaim,
  MsgCreatePendingClaimResponse,
  MsgCreateRequestForFunds,
  MsgCreateRequestForFundsResponse,
} from '@avail-project/ca-common';
import { isDeliverTxFailure, isDeliverTxSuccess } from '@cosmjs/stargate';
import axios from 'axios';
import { connect } from 'it-ws/client';
import Long from 'long';
import { CosmosOptions, getLogger } from '../../../commons';
import { checkIntentFilled, vscCreateFeeGrant } from './api.utils';
import { Errors } from '../errors';

const logger = getLogger();

const getCosmosURL = (cosmosURL: string, kind: 'rest' | 'rpc') => {
  const u = new URL(cosmosURL);
  if (kind === 'rpc') {
    u.port = '26650';
  }
  return u.toString();
};

const cosmosFeeGrant = async (cosmosURL: string, vscDomain: string, address: string) => {
  try {
    await axios.get(`/cosmos/auth/v1beta1/accounts/${address}`, {
      baseURL: getCosmosURL(cosmosURL, 'rest'),
    });
  } catch (e) {
    logger.error('Requesting a fee grant', e, { cause: 'FEE_GRANT_REQUESTED' });
    const response = await vscCreateFeeGrant(vscDomain, address);
    logger.debug('Fee grant response', response.data);
    return;
  }
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
          typeUrl: '/xarchain.chainabstraction.v1.MsgCreateRequestForFunds',
          value: msg,
        },
      ],
      {
        amount: [],
        gas: 100_000n.toString(10),
      },
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
          typeUrl: '/xarchain.chainabstraction.v1.MsgCreatePendingClaim',
          value: MsgCreatePendingClaim.create({
            claim: {
              RFFID: intentID,
              claim: {
                $case: 'refundClaim',
              },
            },
          }),
        },
      ],
      {
        amount: [],
        gas: 200_000n.toString(10),
      },
    );
    logger.debug('Refund response', { resp });
    try {
      if (isDeliverTxSuccess(resp)) {
        const decoded = MsgCreatePendingClaimResponse.decode(resp.msgResponses[0].value);
        logger.debug('Refund success', { decoded, resp });
        return resp;
      } else {
        logger.debug('Refund error', { resp });
        throw Errors.cosmosError(`Refund error`);
      }
    } catch (e) {
      logger.error('Refund failed', e, { cause: 'REFUND_FAILED' });
      throw e;
    }
  } finally {
    client.disconnect();
  }
};

const decoder = new TextDecoder('utf-8');

const cosmosFillCheck = async (
  intentID: Long,
  grpcURL: string,
  cosmosURL: string,
  ac: AbortController,
) => {
  return Promise.any([
    waitForCosmosFillEvent(intentID, cosmosURL, ac),
    checkIntentFilled(intentID, grpcURL),
  ]);
};

const waitForCosmosFillEvent = async (intentID: Long, cosmosURL: string, ac: AbortController) => {
  const u = new URL('/websocket', cosmosURL);
  u.protocol = 'wss';
  u.port = '26650';
  const connection = connect(u.toString());

  await connection.connected();

  ac.signal.addEventListener(
    'abort',
    () => {
      connection.close();
      return Promise.resolve('ok from outside');
    },
    { once: true },
  );

  const EVENT = 'xarchain.chainabstraction.RFFFulfilledEvent.id';

  try {
    connection.socket.send(
      JSON.stringify({
        id: '0',
        jsonrpc: '2.0',
        method: 'subscribe',
        params: {
          query: `${EVENT}='"${intentID}"'`,
        },
      }),
    );

    for await (const resp of connection.source) {
      logger.debug('waitForCosmosFillEvent', {
        resp,
      });
      const decodedResponse = JSON.parse(decoder.decode(resp));
      if (
        decodedResponse.result.events &&
        EVENT in decodedResponse.result.events &&
        decodedResponse.result.events[EVENT].includes(`"${intentID}"`)
      ) {
        ac.abort();
        return 'ok';
      }
    }

    throw Errors.cosmosError('waitForCosmosFillEvent: out of loop but no events');
  } finally {
    connection.close();
  }
};

export { cosmosCreateRFF, cosmosFeeGrant, cosmosFillCheck, cosmosRefundIntent, getCosmosURL };
