import Decimal from 'decimal.js';

import { SOPHON_CHAIN_ID } from '../../constants';
import { getLogger } from '../../logger';
import { Chain, SimulateReturnType } from '@nexus/commons';
import { divDecimals, UserAssets } from '../../utils';

const logger = getLogger();

const tokenRequestParseSimulation = ({
  assets,
  bridge,
  chain,
  iGas,
  simulation,
}: {
  assets: UserAssets;
  bridge: boolean;
  chain: Chain;
  iGas: bigint;
  simulation: SimulateReturnType;
}) => {
  const tokenContract = simulation.token.contractAddress;
  const amount = simulation.amount ?? new Decimal(0);
  const nativeToken = chain.nativeCurrency;

  logger.debug('ERC20RequestBase:ParseSimulation:1', {
    assets,
    tokenContract,
  });
  const { chainsWithBalance, destinationAssetBalance, destinationGasBalance } =
    assets.getAssetDetails(chain, tokenContract);

  const gasMultiple = simulation.gasFee
    .mul(chain.id === SOPHON_CHAIN_ID ? 3 : 2)
    .add(divDecimals(iGas, nativeToken.decimals));

  logger.debug('ERC20RequestBase:ParseSimulation:0', {
    destinationGasBalance,
    expectedGas: gasMultiple.toFixed(),
    simGas: simulation.gasFee.toFixed(),
  });

  const isGasRequiredToBeBorrowed = bridge
    ? gasMultiple.greaterThan(0)
    : gasMultiple.greaterThan(destinationGasBalance);

  let isIntentRequired = false;
  if (bridge) {
    isIntentRequired = true;
  }

  let gas = new Decimal(0);

  logger.debug('ERC20RequestBase:parseSimulation:1', {
    chainsWithBalance,
    destinationAssetBalance,
    isGasRequiredToBeBorrowed,
  });
  if (chainsWithBalance) {
    if (amount.greaterThan(destinationAssetBalance)) {
      isIntentRequired = true;
    }

    if (isGasRequiredToBeBorrowed) {
      isIntentRequired = true;
      gas = bridge ? gasMultiple : gasMultiple.minus(destinationGasBalance);
    }
  }

  return {
    amount,
    gas,
    isIntentRequired,
  };
};

const nativeRequestParseSimulation = ({
  assets,
  bridge,
  chain,
  simulation,
}: {
  assets: UserAssets;
  bridge: boolean;
  chain: Chain;
  simulation: SimulateReturnType;
}) => {
  const { chainsWithBalance, destinationGasBalance } = assets.getAssetDetails(
    chain,
    simulation.token.contractAddress,
  );

  const gasMultiple = simulation.gasFee.mul(2);

  let isIntentRequired = false;

  if (bridge) {
    isIntentRequired = true;
  }

  if (chainsWithBalance) {
    if (simulation.amount.add(gasMultiple).greaterThan(destinationGasBalance)) {
      isIntentRequired = true;
    }
  }

  logger.debug('parseSimulation', {
    amount: simulation.amount.toFixed(),
    destinationGasBalance: destinationGasBalance,
    gas: gasMultiple.toFixed(),
  });

  return {
    amount: simulation.amount,
    gas: gasMultiple,
    isIntentRequired,
  };
};

export { nativeRequestParseSimulation, tokenRequestParseSimulation };
