import { Hex } from 'viem';
import { Types as TronTypes } from 'tronweb';

const isTRC20TokenTransfer = (
  tx:
    | TronTypes.Transaction<TronTypes.TransferContract>
    | TronTypes.Transaction<TronTypes.TriggerSmartContract>,
) => {
  const contractCall = tx.raw_data.contract[0];
  return contractCall && contractCall.type === TronTypes.ContractType.TriggerSmartContract;
};

const isTRXTransfer = (
  tx:
    | TronTypes.Transaction<TronTypes.TransferContract>
    | TronTypes.Transaction<TronTypes.TriggerSmartContract>,
) => {
  const contractCall = tx.raw_data.contract[0];
  return contractCall && contractCall.type === TronTypes.ContractType.TransferContract;
};

function tronHexToEvmAddress(tronHex: string): Hex {
  const normalized = tronHex.toLowerCase().replace(/^0x/, '');

  // Validate length and prefix
  if (!/^41[a-f0-9]{40}$/.test(normalized)) {
    throw new Error(`Invalid TRON hex address: ${tronHex}`);
  }

  // Extract last 20 bytes (40 hex chars) and return as EVM address
  return `0x${normalized.slice(2)}`;
}
export { isTRC20TokenTransfer, isTRXTransfer, tronHexToEvmAddress };
