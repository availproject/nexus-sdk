import {
  createCosmosClient,
  MsgCreateRequestForFunds,
  MsgCreateRequestForFundsResponse,
  MsgDoubleCheckTx,
  MsgRefundReq,
  MsgRefundReqResponse,
} from '@avail-project/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { isDeliverTxFailure, isDeliverTxSuccess } from '@cosmjs/stargate';
import axios from 'axios';
import { connect } from 'it-ws/client';
import Long from 'long';

import { getLogger } from '../logger';
import { checkIntentFilled, vscCreateFeeGrant } from './api.utils';

const logger = getLogger();

const getCosmosURL = (cosmosURL: string, kind: 'rest' | 'rpc') => {
  const u = new URL(cosmosURL);
  if (kind === 'rpc') {
    // FIXME: don't hardcode port here
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
    logger.error('Requesting a fee grant', e);
    const response = await vscCreateFeeGrant(vscDomain, address);
    logger.debug('Fee grant response', response.data);
    return;
  }
};

const cosmosCreateRFF = async ({
  address,
  cosmosURL,
  msg,
  wallet,
}: {
  address: string;
  cosmosURL: string;
  msg: MsgCreateRequestForFunds;
  wallet: DirectSecp256k1Wallet;
}) => {
  const client = await createCosmosClient(wallet, getCosmosURL(cosmosURL, 'rpc'), {
    broadcastPollIntervalMs: 250,
  });
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
      },
    );

    if (isDeliverTxFailure(res)) {
      throw new Error(`Error creating RFF – code=${res.code} log=${res.rawLog ?? 'n/a'}`);
    }

    const decoded = MsgCreateRequestForFundsResponse.decode(res.msgResponses[0].value);
    return decoded.id;
  } finally {
    client.disconnect();
  }
};

const cosmosRefundIntent = async (
  cosmosURL: string,
  intentID: number,
  wallet: DirectSecp256k1Wallet,
) => {
  const address = (await wallet.getAccounts())[0].address;
  const client = await createCosmosClient(wallet, getCosmosURL(cosmosURL, 'rpc'), {
    broadcastPollIntervalMs: 250,
  });
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
        gas: 100_000n.toString(10),
      },
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
        throw new Error('RFF is not expired yet.');
      } else {
        throw new Error('unknown error');
      }
    } catch (e) {
      logger.error('Refund failed', e);
      throw e;
    }
  } finally {
    client.disconnect();
  }
};

const cosmosCreateDoubleCheckTx = async ({
  address,
  cosmosURL,
  msg,
  wallet,
}: {
  address: string;
  cosmosURL: string;
  msg: MsgDoubleCheckTx;
  wallet: DirectSecp256k1Wallet;
}) => {
  const client = await createCosmosClient(wallet, getCosmosURL(cosmosURL, 'rpc'), {
    broadcastPollIntervalMs: 250,
  });

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
      },
    );

    if (isDeliverTxFailure(res)) {
      throw new Error('Error creating MsgDoubleCheckTx');
    }

    logger.debug('double check response', { doubleCheckTx: res });
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

    throw new Error('waitForCosmosFillEvent: out of loop but no events');
  } finally {
    connection.close();
  }
};

export {
  cosmosCreateDoubleCheckTx,
  cosmosCreateRFF,
  cosmosFeeGrant,
  cosmosFillCheck,
  cosmosRefundIntent,
  getCosmosURL,
};
