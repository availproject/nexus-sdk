import {
  type Bytes,
  ChaindataMap,
  CurrencyID,
  ERC20ABI,
  msgpackableAxios,
  OmniversalChainID,
  PermitVariant,
  type QuoteResponse,
  Universe,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import Long from 'long';
import {
  type ByteArray,
  bytesToBigInt,
  bytesToNumber,
  concat,
  createPublicClient,
  encodeFunctionData,
  type Hex,
  http,
  maxUint256,
  type PrivateKeyAccount,
  type PublicClient,
  pad,
  parseSignature,
  toBytes,
  toHex,
  type WalletClient,
} from 'viem';
import { ERC20PermitABI, ETHEREUM_USDT_APPROVE_ABI } from '../abi/erc20';
import { SWEEP_ABI } from '../abi/sweep';
import {
  type AnkrBalances,
  type Chain,
  type ChainListType,
  type DestinationExecution,
  getLogger,
  type SBCTx,
  SUPPORTED_CHAINS,
  type SuccessfulSwapResult,
  SWAP_STEPS,
  type SwapStepType,
  TOKEN_CONTRACT_ADDRESSES,
  type Tx,
  type UnifiedBalanceResponseData,
  type UserAssetDatum,
  type VSCClient,
} from '../commons';
import { getLogoFromSymbol, ZERO_ADDRESS } from '../core/constants';
import { Errors } from '../core/errors';
import {
  convertAddressByUniverse,
  convertTo32BytesHex,
  createDeadlineFromNow,
  divDecimals,
  equalFold,
  getExplorerURL,
  signPermitForAddressAndValue,
  switchChain,
  waitForTxReceipt,
} from '../core/utils';
import { estimateRepresentativeSwapNativeReserveFee } from '../services/swapNativeReserveFee';
import { CALIBUR_ADDRESS, EADDRESS, SWEEPER_ADDRESS } from './constants';
import { type FlatBalance, getPermitVariantAndVersion, isTokenSupported } from './data';
import { createSafeExecuteTxFromCalls, type SafeExecuteTx } from './safetx';
import { createSBCTxFromCalls, waitForSBCTxReceipt } from './sbc';

const USD_DECIMAL_PLACES = 6;
const logger = getLogger();

/**
 * Boundary check for any SDK entry point that swaps to a given destination chain. Throws
 * `chainNotFound` if the chain isn't in the registry, or `swapNotSupportedOnChain` if the chain
 * exists but doesn't have swaps enabled. Returns the resolved Chain on success so callers can
 * reuse it without a second lookup.
 *
 * Call this at the SDK entry point (e.g., `swap()`, `calculateMaxForSwap`, `swapAndExecute`)
 * — not deep in the pipeline. Failing fast here avoids wasted balance fetches, fee-store calls,
 * and aggregator quotes for a request we already know we can't fulfill.
 */
export const validateDestinationChainForSwap = (
  chainList: ChainListType,
  toChainId: number
): Chain => {
  const chain = chainList.getChainByID(toChainId);
  if (!chain) {
    throw Errors.chainNotFound(toChainId);
  }
  if (!chain.swapSupported) {
    throw Errors.swapNotSupportedOnChain(chain.id, chain.name);
  }
  return chain;
};

export const convertTo32Bytes = (
  input: `0x${string}` | bigint | ByteArray | number
): Uint8Array => {
  if (typeof input === 'string') {
    return toBytes(pad(input, { dir: 'left', size: 32 }));
  }

  if (typeof input === 'bigint' || typeof input === 'number') {
    return toBytes(input, {
      size: 32,
    });
  }

  return pad(input, { dir: 'left', size: 32 });
};

export const convertToEVMAddress = (addr: Hex | Uint8Array) => {
  let address = addr;
  if (typeof address === 'string') {
    address = toBytes(address);
  }

  if (address.length === 20) {
    return toHex(address);
  }

  if (address.length === 32) {
    return toHex(address.subarray(12));
  }

  throw Errors.invalidAddressLength('evm');
};

export const bytesEqual = (bytes1: Uint8Array, bytes2: Uint8Array): boolean => {
  logger.debug('bytesEqual', {
    bytes1,
    bytes2,
  });

  if (bytes1.length !== bytes2.length) {
    return false;
  }

  for (let i = 0; i < bytes1.length; i++) {
    if (bytes1[i] !== bytes2[i]) {
      return false;
    }
  }

  return true;
};

export const EXPECTED_CALIBUR_CODE = concat(['0xef0100', CALIBUR_ADDRESS]);
const EIP7702_DELEGATION_PREFIX = '0xef0100';
const EIP7702_DELEGATION_CODE_HEX_LENGTH = 48; // 0x + 3-byte prefix + 20-byte delegate

export const isEip7702DelegatedCode = (code?: Hex) => {
  const normalizedCode = (code ?? '0x').toLowerCase();
  return (
    normalizedCode.startsWith(EIP7702_DELEGATION_PREFIX) &&
    normalizedCode.length === EIP7702_DELEGATION_CODE_HEX_LENGTH
  );
};

export const isAuthorizationCodeSet = async (
  chainID: number,
  address: `0x${string}`,
  cache: Cache
) => {
  const code = cache.getCode({
    address,
    chainID,
  });

  logger.debug('isAuthorizationCodeSet', { code, EXPECTED_CALIBUR_CODE });
  if (!code) {
    return false;
  }

  return code !== '0x' && equalFold(code, EXPECTED_CALIBUR_CODE);
};

export const isNativeAddress = (contractAddress: Hex) =>
  equalFold(contractAddress, ZERO_ADDRESS) || equalFold(contractAddress, EADDRESS);

/**
 * Creates EIP2612 signature or executes non sponsored approval and transferFrom Tx.
 *
 * Direct-approval (non-permit) branch: `writeContract` fires the on-chain approve
 * synchronously (wallet signature happens before this function returns), but the
 * receipt wait + cache update are returned as `pending` so callers can batch
 * multiple approvals' mining waits in parallel (e.g. via `Promise.all`) instead
 * of blocking the loop on each one.
 *
 * Today only `SourceSwapsHandler.process` consumes `pending` directly. Other
 * callers use the {@link createPermitAndTransferFromTx} wrapper below which
 * awaits `pending` inline, preserving the original sequential semantics.
 */
export const createPermitAndTransferFromTxNoSendCalls = async ({
  amount,
  approval,
  cache,
  chain,
  contractAddress,
  disablePermit,
  owner,
  ownerWallet,
  publicClient,
  spender,
}: {
  amount: bigint;
  approval?: Tx;
  cache: Cache;
  chain: Chain;
  contractAddress: Hex;
  disablePermit?: boolean;
  owner: Hex;
  ownerWallet: WalletClient;
  publicClient: PublicClient;
  spender: Hex;
}): Promise<{ txs: Tx[]; pending?: Promise<void> }> => {
  const txList: Tx[] = [];
  let pending: Promise<void> | undefined;
  await switchChain(ownerWallet, chain);

  logger.debug('createPermitCalls', {
    contractAddress,
    EADDRESS,
  });

  let allowance = cache.getAllowance({
    chainID: chain.id,
    contractAddress,
    owner,
    spender,
  });

  if (allowance === undefined) {
    logger.debug('createPermitCalls: allowance not found in cache', {
      cache,
      chain,
      contractAddress,
      owner,
      spender,
    });
    allowance = await publicClient.readContract({
      abi: ERC20ABI,
      address: contractAddress,
      args: [owner, spender],
      functionName: 'allowance',
    });
  }

  logger.debug('createPermitTx', { allowance, amount });

  if (allowance < amount) {
    let shouldUseDirectApproval = disablePermit === true;
    let variant = PermitVariant.Unsupported;
    let version = 0;

    if (!shouldUseDirectApproval) {
      const permitDetails =
        cache.getPermit({ chainID: chain.id, contractAddress }) ??
        (await getPermitVariantAndVersion(contractAddress, publicClient));
      variant = permitDetails.variant;
      version = permitDetails.version;
      shouldUseDirectApproval = variant === PermitVariant.Unsupported;
    }

    if (shouldUseDirectApproval) {
      const abi = equalFold(
        TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.ETHEREUM],
        contractAddress
      )
        ? [ETHEREUM_USDT_APPROVE_ABI]
        : ERC20ABI;
      const { request } = await publicClient.simulateContract({
        chain,
        abi,
        account: owner,
        address: contractAddress,
        args: [spender, amount],
        functionName: 'approve',
      });
      const hash = await ownerWallet.writeContract(request);
      pending = waitForTxReceipt(hash, publicClient, 1).then(() => {
        // On retry the value will be present, so no need to refetch allowance
        cache.addAllowanceValue(
          {
            chainID: chain.id,
            contractAddress,
            owner,
            spender,
          },
          amount
        );
      });
    } else {
      const approvalTx =
        approval ??
        (await createPermitApprovalTx({
          amount,
          chain,
          contractAddress,
          owner,
          ownerWallet,
          publicClient,
          spender,
          variant,
          version,
        }));
      txList.push(approvalTx);
    }
  }

  txList.push({
    data: encodeFunctionData({
      abi: ERC20ABI,
      args: [owner, spender, amount],
      functionName: 'transferFrom',
    }),
    to: contractAddress,
    value: 0n,
  });

  return { txs: txList, pending };
};

/**
 * Backwards-compatible wrapper around {@link createPermitAndTransferFromTxNoSendCalls}
 * that awaits the on-chain approval mining inline before returning. Existing callers
 * (BridgeHandler, DestinationSwapHandler, CombinedSwapHandler) keep their sequential
 * "approve → mine → continue" semantics.
 */
export const createPermitAndTransferFromTx = async (
  params: Parameters<typeof createPermitAndTransferFromTxNoSendCalls>[0]
): Promise<Tx[]> => {
  const { txs, pending } = await createPermitAndTransferFromTxNoSendCalls(params);
  if (pending) {
    await pending;
  }
  return txs;
};

type SourceSwapApprovalInput = {
  amountRaw: bigint;
  contractAddress: Hex;
  symbol: string;
};

/**
 * Per-chain EIP-5792 variant of {@link createPermitAndTransferFromTxNoSendCalls}.
 *
 * Iterates the chain's non-native source swaps and produces a per-swap `txs` array
 * matching the per-swap call shape consumed by `SourceSwapsHandler.process`:
 *   - permit-supported tokens → `[permit, transferFrom]`
 *   - direct-approval tokens with sufficient cached allowance → `[transferFrom]`
 *   - direct-approval tokens needing approval → `[transferFrom]`, with the `approve`
 *     call queued and sent as ONE `wallet_sendCalls` bundle after the loop. The
 *     bundle's mining wait + cache updates are returned as `pending` so the caller
 *     can defer awaiting until just before the Safe/Calibur batch is submitted.
 *
 * Callers must first verify {@link hasSendCallsSupport} for the chain. Bundling a
 * single approve has no UX benefit over `writeContract`, so dispatch to this path
 * only when the chain has 2+ source swaps.
 */
export const createPermitAndTransferFromCallsWithSendCalls = async ({
  swaps,
  cache,
  chain,
  disablePermit,
  owner,
  ownerWallet,
  publicClient,
  spender,
}: {
  swaps: SourceSwapApprovalInput[];
  cache: Cache;
  chain: Chain;
  disablePermit?: boolean;
  owner: Hex;
  ownerWallet: WalletClient;
  publicClient: PublicClient;
  spender: Hex;
}): Promise<{ txsPerSwap: Tx[][]; pending?: Promise<void> }> => {
  await switchChain(ownerWallet, chain);

  const txsPerSwap: Tx[][] = [];
  const queuedApproves: {
    call: { to: Hex; data: Hex; value: bigint };
    allowanceKey: Parameters<Cache['addAllowanceValue']>[0];
    amount: bigint;
  }[] = [];

  for (const swap of swaps) {
    const { amountRaw: amount, contractAddress } = swap;
    const txList: Tx[] = [];

    let allowance = cache.getAllowance({
      chainID: chain.id,
      contractAddress,
      owner,
      spender,
    });

    if (allowance === undefined) {
      allowance = await publicClient.readContract({
        abi: ERC20ABI,
        address: contractAddress,
        args: [owner, spender],
        functionName: 'allowance',
      });
    }

    if (allowance < amount) {
      let shouldUseDirectApproval = disablePermit === true;
      let variant = PermitVariant.Unsupported;
      let version = 0;

      if (!shouldUseDirectApproval) {
        const permitDetails =
          cache.getPermit({ chainID: chain.id, contractAddress }) ??
          (await getPermitVariantAndVersion(contractAddress, publicClient));
        variant = permitDetails.variant;
        version = permitDetails.version;
        shouldUseDirectApproval = variant === PermitVariant.Unsupported;
      }

      if (shouldUseDirectApproval) {
        const abi = equalFold(
          TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.ETHEREUM],
          contractAddress
        )
          ? [ETHEREUM_USDT_APPROVE_ABI]
          : ERC20ABI;
        const data = encodeFunctionData({
          abi,
          args: [spender, amount],
          functionName: 'approve',
        });
        queuedApproves.push({
          call: { to: contractAddress, data, value: 0n },
          allowanceKey: { chainID: chain.id, contractAddress, owner, spender },
          amount,
        });
      } else {
        const approvalTx = await createPermitApprovalTx({
          amount,
          chain,
          contractAddress,
          owner,
          ownerWallet,
          publicClient,
          spender,
          variant,
          version,
        });
        txList.push(approvalTx);
      }
    }

    txList.push({
      data: encodeFunctionData({
        abi: ERC20ABI,
        args: [owner, spender, amount],
        functionName: 'transferFrom',
      }),
      to: contractAddress,
      value: 0n,
    });

    txsPerSwap.push(txList);
  }

  let pending: Promise<void> | undefined;
  if (queuedApproves.length > 0) {
    const { id } = await ownerWallet.sendCalls({
      account: owner,
      chain,
      calls: queuedApproves.map((q) => q.call),
    });
    pending = ownerWallet.waitForCallsStatus({ id }).then((result) => {
      if (result.status !== 'success') {
        throw Errors.internal(`wallet_sendCalls bundle ${id} ended with status ${result.status}`);
      }
      for (const q of queuedApproves) {
        cache.addAllowanceValue(q.allowanceKey, q.amount);
      }
    });
  }

  return { txsPerSwap, pending };
};

const domainSeparatorAbi = [
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    inputs: [],
    stateMutability: 'view',
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

const noncesAbi = [
  {
    type: 'function',
    name: 'nonces',
    inputs: [{ name: 'owner', type: 'address' }],
    stateMutability: 'view',
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const determinePermitVariantAndVersion = async (
  client: PublicClient,
  contractAddress: Hex
) => {
  const [hasDomainSeparator, hasNonces, version] = await Promise.all([
    client
      .readContract({
        address: contractAddress,
        abi: domainSeparatorAbi,
        functionName: 'DOMAIN_SEPARATOR',
      })
      .then(() => true)
      .catch(() => false),
    client
      .readContract({
        address: contractAddress,
        abi: noncesAbi,
        functionName: 'nonces',
        args: ['0x0000000000000000000000000000000000000000'],
      })
      .then(() => true)
      .catch(() => false),
    getVersion(client, contractAddress),
  ]);

  let variant = PermitVariant.Unsupported;
  if (hasDomainSeparator && hasNonces) {
    variant = PermitVariant.EIP2612Canonical;
  }

  return {
    variant,
    version: Number(version),
  };
};

async function getVersion(client: PublicClient, token: `0x${string}`): Promise<string> {
  try {
    const result = await client.readContract({
      address: token,
      abi: [
        {
          type: 'function',
          name: 'version',
          inputs: [],
          stateMutability: 'view',
          outputs: [{ name: '', type: 'string' }],
        },
      ] as const,
      functionName: 'version',
    });
    return result;
  } catch {
    return '1';
  }
}

export const createPermitApprovalTx = async ({
  amount,
  chain,
  contractAddress,
  owner,
  ownerWallet,
  publicClient,
  spender,
  variant,
  version,
}: {
  amount: bigint;
  chain: Chain;
  contractAddress: Hex;
  owner: Hex;
  ownerWallet: WalletClient;
  publicClient: PublicClient;
  spender: Hex;
  variant: PermitVariant;
  version: number;
}) => {
  const deadline = createDeadlineFromNow(3n);
  const signature = await signPermitForAddressAndValue({
    chain,
    client: ownerWallet,
    deadline,
    permitContractVersion: version,
    permitVariant: variant,
    publicClient,
    spender,
    tokenAddress: contractAddress,
    value: amount,
    walletAddress: owner,
  });

  const { r, s, v } = parseSignature(signature);
  if (!v) {
    throw Errors.internal('invalid signature: v is not present');
  }

  return {
    data:
      variant === PermitVariant.PolygonEMT
        ? encodeFunctionData({
            abi: ERC20PermitABI,
            args: [owner, packERC20Approve(spender, amount), r, s, Number(v)],
            functionName: 'executeMetaTransaction',
          })
        : encodeFunctionData({
            abi: ERC20PermitABI,
            args: [owner, spender, amount, deadline, Number(v), r, s],
            functionName: 'permit',
          }),
    to: contractAddress,
    value: 0n,
  };
};

export const createPermitOnlyApprovalTx = async ({
  amount,
  chain,
  contractAddress,
  deadline,
  owner,
  publicClient,
  signerWallet,
  spender,
}: {
  amount: bigint;
  chain: Chain;
  contractAddress: Hex;
  deadline: bigint;
  owner: Hex;
  publicClient: PublicClient;
  signerWallet: PrivateKeyAccount;
  spender: Hex;
}): Promise<Tx> => {
  if (!equalFold(owner, signerWallet.address)) {
    throw Errors.internal('permit signer must match permit owner');
  }

  const { variant, version } = await getPermitVariantAndVersion(contractAddress, publicClient);
  if (variant !== PermitVariant.EIP2612Canonical) {
    throw Errors.tokenNotSupported(undefined, undefined, '(2612 details not found)');
  }

  const signature = await signPermitForAddressAndValue({
    chain,
    client: signerWallet,
    deadline,
    permitContractVersion: version,
    permitVariant: variant,
    publicClient,
    spender,
    tokenAddress: contractAddress,
    value: amount,
    walletAddress: owner,
  });

  const { r, s, v } = parseSignature(signature);
  if (!v) {
    throw Errors.internal('invalid signature: v is not present');
  }

  return {
    data: encodeFunctionData({
      abi: ERC20PermitABI,
      args: [owner, spender, amount, deadline, Number(v), r, s],
      functionName: 'permit',
    }),
    to: contractAddress,
    value: 0n,
  };
};

export const packERC20Approve = (spender: Hex, amount: bigint) => {
  return encodeFunctionData({
    abi: ERC20ABI,
    args: [spender, amount],
    functionName: 'approve',
  });
};

export const fetchTransferFees = async (
  chains: Chain[],
  publicClientList?: PublicClientList
): Promise<Map<number, Decimal>> => {
  const feeByChainID = new Map<number, Decimal>();
  await Promise.all(
    chains.map(async (chain) => {
      try {
        // Reuse the cached, multicall-batched PublicClient when the caller supplies a
        // PublicClientList. Falls back to a fresh fallback client so legacy call sites
        // (and unit tests) keep working without threading it through.
        const fee = await estimateRepresentativeSwapNativeReserveFee({
          chain,
          publicClient: publicClientList?.get(chain.id),
        });
        feeByChainID.set(chain.id, divDecimals(fee, chain.nativeCurrency.decimals));
      } catch (e) {
        logger.error('fetchTransferFees', e, { chainID: chain.id });
      }
    })
  );
  return feeByChainID;
};

export function getTokenSymbol(symbol: string) {
  if (['USD₮', 'USD₮0', 'USDt'].includes(symbol)) {
    return 'USDT';
  }
  return symbol;
}

export const toFlatBalance = (
  assets: UserAssetDatum[],
  convertAddressToBytes32 = true,
  currentChainID?: number,
  selectedTokenAddress?: `0x${string}`
): FlatBalance[] => {
  logger.debug('toFlatBalance', {
    assets,
  });
  return assets
    .flatMap((a) =>
      a.breakdown.map((b) => {
        const tokenAddress = equalFold(b.contractAddress, ZERO_ADDRESS)
          ? EADDRESS
          : b.contractAddress;
        return {
          amount: b.balance,
          chainID: b.chain.id,
          decimals: b.decimals,
          symbol: a.symbol,
          tokenAddress: convertAddressToBytes32 ? convertTo32BytesHex(tokenAddress) : tokenAddress,
          universe: b.universe,
          value: b.balanceInFiat,
          logo: a.icon ?? '',
        };
      })
    )
    .filter((b) => {
      return !(b.chainID === currentChainID && equalFold(b.tokenAddress, selectedTokenAddress));
    })
    .filter((b) => b.universe === Universe.ETHEREUM && new Decimal(b.amount).gt(0));
};

export const vscBalancesToAssets = (
  chainList: ChainListType,
  evmBalances: UnifiedBalanceResponseData[] = []
) => {
  const assets: UserAssetDatum[] = [];
  const vscBalances = evmBalances;

  logger.debug('balanceToAssets', {
    evmBalances,
  });
  for (const balance of vscBalances) {
    for (const currency of balance.currencies) {
      const chain = chainList.getChainByID(bytesToNumber(balance.chain_id));
      if (!chain) {
        continue;
      }
      const tokenAddress = convertAddressByUniverse(
        toHex(currency.token_address),
        balance.universe
      );
      const token = chainList.getTokenByAddress(chain.id, tokenAddress);
      const decimals = token ? token.decimals : chain.nativeCurrency.decimals;

      if (token) {
        const groupSymbol = token.equivalentCurrency ?? token.symbol;
        const asset = assets.find((s) => equalFold(s.symbol, groupSymbol));
        if (asset) {
          asset.balance = new Decimal(asset.balance).add(currency.balance).toFixed();
          asset.balanceInFiat = new Decimal(asset.balanceInFiat)
            .add(currency.value)
            .toDecimalPlaces(USD_DECIMAL_PLACES)
            .toNumber();
          asset.breakdown.push({
            balance: currency.balance,
            balanceInFiat: new Decimal(currency.value)
              .toDecimalPlaces(USD_DECIMAL_PLACES)
              .toNumber(),
            chain: {
              id: bytesToNumber(balance.chain_id),
              logo: chain.custom.icon,
              name: chain.name,
            },
            contractAddress: tokenAddress,
            symbol: token.symbol,
            decimals,
            universe: balance.universe,
          });
        } else {
          assets.push({
            balance: currency.balance,
            balanceInFiat: new Decimal(currency.value)
              .toDecimalPlaces(USD_DECIMAL_PLACES)
              .toNumber(),
            breakdown: [
              {
                balance: currency.balance,
                balanceInFiat: new Decimal(currency.value)
                  .toDecimalPlaces(USD_DECIMAL_PLACES)
                  .toNumber(),
                chain: {
                  id: bytesToNumber(balance.chain_id),
                  logo: chain.custom.icon,
                  name: chain.name,
                },
                symbol: token.symbol,
                contractAddress: tokenAddress,
                decimals,
                universe: balance.universe,
              },
            ],
            decimals: token.decimals,
            icon: getLogoFromSymbol(groupSymbol),
            symbol: groupSymbol,
          });
        }
      }
    }
  }

  for (const asset of assets) {
    asset.breakdown.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  }
  assets.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  return assets;
};

export const ankrBalanceToAssets = (
  chainList: ChainListType,
  ankrBalances: AnkrBalances,
  filterWithSupportedTokens: boolean
) => {
  const assets: UserAssetDatum[] = [];

  for (const asset of ankrBalances) {
    if (new Decimal(asset.balance).equals(0)) {
      continue;
    }

    // Check if filter with supportedToken is ON and token is not in the list
    const isSupportedToken = isTokenSupported(
      asset.chainID,
      convertTo32BytesHex(asset.tokenAddress)
    );

    if (filterWithSupportedTokens && !isSupportedToken) {
      continue;
    }

    const chain = chainList.getChainByID(asset.chainID);
    if (!chain) {
      continue;
    }
    const resolvedToken = chainList.getTokenByAddress(chain.id, asset.tokenAddress);
    const groupSymbol = resolvedToken?.equivalentCurrency ?? asset.tokenData.symbol;
    const existingAsset = assets.find((a) => equalFold(a.symbol, groupSymbol));
    if (existingAsset) {
      if (
        !existingAsset.breakdown.some(
          (t) => t.chain.id === chain.id && equalFold(t.contractAddress, asset.tokenAddress)
        )
      ) {
        existingAsset.balance = Decimal.add(existingAsset.balance, asset.balance).toFixed();
        existingAsset.balanceInFiat = Decimal.add(existingAsset.balanceInFiat, asset.balanceUSD)
          .toDecimalPlaces(USD_DECIMAL_PLACES)
          .toNumber();

        existingAsset.breakdown.push({
          balance: asset.balance,
          balanceInFiat: new Decimal(asset.balanceUSD)
            .toDecimalPlaces(USD_DECIMAL_PLACES)
            .toNumber(),
          chain: {
            id: chain.id,
            logo: chain.custom.icon,
            name: chain.name,
          },
          symbol: asset.tokenData.symbol,
          contractAddress: asset.tokenAddress,
          decimals: asset.tokenData.decimals,
          universe: asset.universe,
        });
      }
    } else {
      assets.push({
        balance: asset.balance,
        balanceInFiat: new Decimal(asset.balanceUSD).toDecimalPlaces(USD_DECIMAL_PLACES).toNumber(),
        breakdown: [
          {
            balance: asset.balance,
            balanceInFiat: new Decimal(asset.balanceUSD)
              .toDecimalPlaces(USD_DECIMAL_PLACES)
              .toNumber(),
            chain: {
              id: chain.id,
              logo: chain.custom.icon,
              name: chain.name,
            },
            symbol: asset.tokenData.symbol,
            contractAddress: asset.tokenAddress,
            decimals: asset.tokenData.decimals,
            universe: asset.universe,
          },
        ],
        decimals: asset.tokenData.decimals,
        icon: asset.tokenData.icon,
        symbol: groupSymbol,
      });
    }
  }

  for (const asset of assets) {
    asset.breakdown.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  }
  assets.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  return assets;
};

export const average = (a: bigint, b: bigint) => {
  return (a & b) + ((a ^ b) >> 1n);
};

export type AllowanceInput = {
  chainID: number;
  contractAddress: Hex;
  owner: Hex;
  spender: Hex;
};

export type CreateAllowanceCacheInput = Set<AllowanceInput>;
export type SetCodeInput = {
  address: Hex;
  chainID: number;
};

export type PermitQueryInput = {
  chainID: number;
  contractAddress: Hex;
};

export class Cache {
  public allowanceValues: Map<string, bigint> = new Map();
  public setCodeValues: Map<string, Hex | undefined> = new Map();
  private readonly allowanceQueries: Map<string, AllowanceInput> = new Map();
  private readonly setCodeQueries: Map<string, SetCodeInput> = new Map();
  private readonly permitQueries: Map<string, PermitQueryInput> = new Map();
  private readonly permitValues: Map<string, { variant: PermitVariant; version: number }> =
    new Map();

  constructor(private readonly publicClientList: PublicClientList) {}

  addAllowanceQuery(input: AllowanceInput) {
    this.allowanceQueries.set(getAllowanceCacheKey(input), input);
  }

  addAllowanceValue(input: AllowanceInput, value: bigint) {
    this.allowanceValues.set(getAllowanceCacheKey(input), value);
  }

  addSetCodeQuery(input: SetCodeInput) {
    this.setCodeQueries.set(getSetCodeKey(input), input);
  }

  addSetCodeValue(input: SetCodeInput, value: Hex) {
    this.setCodeValues.set(getSetCodeKey(input), value);
  }

  getAllowance(input: AllowanceInput) {
    return this.allowanceValues.get(getAllowanceCacheKey(input));
  }

  getCode(input: SetCodeInput) {
    return this.setCodeValues.get(getSetCodeKey(input));
  }

  addPermitQuery(input: PermitQueryInput) {
    this.permitQueries.set(getPermitCacheKey(input), input);
  }

  getPermit(input: PermitQueryInput) {
    return this.permitValues.get(getPermitCacheKey(input));
  }

  async process() {
    await Promise.all([
      this.processAllowanceRequests(),
      this.processGetCodeRequests(),
      this.processPermitRequests(),
    ]);
  }

  private async processAllowanceRequests() {
    const unprocessedInput = [...this.allowanceQueries.values()].filter(
      (v) => this.getAllowance(v) === undefined
    );
    const inputByChainID = Map.groupBy(unprocessedInput, (i) => i.chainID);
    const requests = [];

    for (const [chainID, inputs] of inputByChainID) {
      const publicClient = this.publicClientList.get(chainID);

      for (const input of inputs) {
        requests.push(
          isNativeAddress(input.contractAddress)
            ? Promise.resolve(this.allowanceValues.set(getAllowanceCacheKey(input), maxUint256))
            : publicClient
                .readContract({
                  abi: ERC20ABI,
                  address: input.contractAddress,
                  args: [input.owner, input.spender],
                  functionName: 'allowance',
                })
                .then((allowance) => {
                  this.allowanceValues.set(getAllowanceCacheKey(input), allowance);
                })
        );
      }
    }

    await Promise.all(requests);
  }

  private async processGetCodeRequests() {
    const requests = [];

    for (const input of this.setCodeQueries.values()) {
      const publicClient = this.publicClientList.get(input.chainID);
      requests.push(
        publicClient
          .getCode({
            address: input.address,
          })
          .then((code) => {
            this.setCodeValues.set(getSetCodeKey(input), code);
          })
      );
    }
    await Promise.all(requests);
  }

  private async processPermitRequests() {
    const requests: Promise<void>[] = [];
    for (const input of this.permitQueries.values()) {
      if (this.getPermit(input)) continue;
      const publicClient = this.publicClientList.get(input.chainID);
      requests.push(
        getPermitVariantAndVersion(input.contractAddress, publicClient).then((result) => {
          this.permitValues.set(getPermitCacheKey(input), result);
        })
      );
    }
    await Promise.all(requests);
  }
}

// To remove duplication of publicClients
export class PublicClientList {
  private list: Record<number, PublicClient> = {};
  constructor(private readonly chainList: ChainListType) {}

  get(chainID: bigint | number | string) {
    let client = this.list[Number(chainID)];
    if (!client) {
      const chain = this.chainList.getChainByID(Number(chainID));
      if (!chain) {
        throw Errors.chainNotFound(Number(chainID));
      }
      client = createPublicClient({
        transport: http(chain.rpcUrls.default.http[0]),
        batch: {
          multicall: true,
        },
      });
      this.list[Number(chainID)] = client;
    }

    return client;
  }
}

export const getAllowanceCacheKey = ({
  chainID,
  contractAddress,
  owner,
  spender,
}: AllowanceInput) => `a${contractAddress}${chainID}${owner}${spender}`.toLowerCase();

export const getSetCodeKey = (input: SetCodeInput) =>
  `a${input.chainID}${input.address}`.toLowerCase();

export const getPermitCacheKey = (input: PermitQueryInput) =>
  `p${input.contractAddress}${input.chainID}`.toLowerCase();

export const parseQuote = (swap: QuoteResponse, createApproval = true) => {
  const { input, txData } = swap.quote;
  const val = {
    approval: null as null | Tx,
    tx: {
      to: txData.tx.to,
      data: txData.tx.data,
      value: BigInt(txData.tx.value),
    } as Tx,
  };
  if (createApproval) {
    val.approval = {
      data: packERC20Approve(txData.approvalAddress, input.amountRaw),
      to: input.contractAddress,
      value: 0n,
    };
  }

  return val;
};

/**
 * Creates Tx object depending on contractAddress being native or ERC20
 */
export const createTransfer = ({
  amount,
  contractAddress,
  data,
  spender,
}: {
  amount: bigint;
  contractAddress: Hex;
  data: Hex;
  owner: Hex;
  spender: Hex;
  value: bigint;
}) => {
  const tx: Tx[] = [];

  if (!equalFold(contractAddress, ZERO_ADDRESS)) {
    tx.push({
      data: packERC20Approve(spender, amount),
      to: contractAddress,
      value: 0n,
    });
  }

  tx.push({
    data: data,
    to: contractAddress,
    value: amount,
  });

  return tx;
};

export const getTokenInfo = async (
  contractAddress: Hex,
  publicClient: PublicClient,
  chain: Chain
) => {
  if (isNativeAddress(contractAddress)) {
    return {
      contractAddress: ZERO_ADDRESS,
      decimals: chain.nativeCurrency.decimals,
      symbol: chain.nativeCurrency.symbol,
    };
  } else {
    const [decimals, symbol] = await Promise.all([
      publicClient.readContract({
        abi: ERC20ABI,
        address: contractAddress,
        functionName: 'decimals',
      }),
      publicClient.readContract({
        abi: ERC20ABI,
        address: contractAddress,
        functionName: 'symbol',
      }),
    ]);

    return { contractAddress, decimals, symbol };
  }
};

const metadataAxios = msgpackableAxios.create({
  baseURL: 'https://metadata-cerise.arcana.network',
});

const types = {
  Record: [
    { name: 'rff_id', type: 'uint256' },
    { name: 'has_xcs', type: 'bool' },
    { name: 'src', type: 'Transaction[]' },
    { name: 'dst', type: 'Transaction' },
  ],
  Transaction: [
    { name: 'univ', type: 'uint8' },
    { name: 'chid', type: 'bytes32' },
    { name: 'tx_hash', type: 'bytes32' },
    { name: 'swaps', type: 'XCSSwap[]' },
  ],
  XCSSwap: [
    { name: 'input_contract', type: 'bytes32' },
    { name: 'input_amt', type: 'uint256' },
    { name: 'input_decimals', type: 'uint8' },
    { name: 'output_contract', type: 'bytes32' },
    { name: 'output_amt', type: 'uint256' },
    { name: 'output_decimals', type: 'uint8' },
    { name: 'agg', type: 'uint8' },
  ],
} as const;

export type SwapMetadata = {
  dst: SwapMetadataTx;
  has_xcs: boolean;
  rff_id: bigint;
  src: SwapMetadataTx[];
};

export type SwapMetadataTx = {
  chid: Bytes;
  swaps: {
    agg: number;
    input_amt: Bytes;
    input_contract: Bytes;
    input_decimals: number;
    output_amt: Bytes;
    output_contract: Bytes;
    output_decimals: number;
  }[];
  tx_hash: Bytes;
  univ: number;
};

const convertSwapMetaToSwap = (src: SwapMetadataTx) => {
  const swaps = src.swaps.map((s) => {
    return {
      inputAmount: bytesToBigInt(s.input_amt),
      inputContract: convertToEVMAddress(s.input_contract),
      inputDecimals: s.input_decimals,
      outputAmount: bytesToBigInt(s.output_amt),
      outputContract: convertToEVMAddress(s.output_contract),
      outputDecimals: s.output_decimals,
    };
  });
  return {
    chainId: bytesToNumber(src.chid),
    swaps,
    txHash: toHex(src.tx_hash),
  };
};

export const convertMetadataToSwapResult = (
  metadata: SwapMetadata,
  baseURL: string
): SuccessfulSwapResult => {
  return {
    sourceSwaps: metadata.src.map(convertSwapMetaToSwap),
    explorerURL: getExplorerURL(baseURL, Long.fromBigInt(metadata.rff_id)),
    destinationSwap: convertSwapMetaToSwap(metadata.dst),
  };
};

function mswap2eip712swap(input: SwapMetadataTx['swaps'][0]) {
  return {
    agg: input.agg,
    input_amt: bytesToBigInt(input.input_amt),
    input_contract: toHex(input.input_contract),
    input_decimals: input.input_decimals,
    output_amt: bytesToBigInt(input.output_amt),
    output_contract: toHex(input.output_contract),
    output_decimals: input.output_decimals,
  };
}

export const calculateValue = (
  amount: Decimal.Value,
  value: Decimal.Value,
  newAmount: Decimal.Value
) => {
  return Decimal.div(value, amount).mul(newAmount);
};

function mtx2eip712tx(input: SwapMetadataTx) {
  return {
    chid: toHex(input.chid),
    swaps: input.swaps.map(mswap2eip712swap),
    tx_hash: toHex(input.tx_hash),
    univ: input.univ,
  };
}

export const postSwap = async ({
  metadata,
  wallet,
}: {
  metadata: SwapMetadata;
  wallet: PrivateKeyAccount;
}) => {
  logger.debug('metadata', {
    metadata,
    msg: {
      ...metadata,
      dst: mtx2eip712tx(metadata.dst),
      src: metadata.src.map(mtx2eip712tx),
    },
  });
  const signature = await wallet.signTypedData({
    domain: {
      chainId: 1n,
      name: 'CA Metadata',
      verifyingContract: ZERO_ADDRESS,
      version: '0.0.1',
    },
    message: {
      ...metadata,
      dst: mtx2eip712tx(metadata.dst),
      src: metadata.src.map(mtx2eip712tx),
    },
    primaryType: 'Record',
    types,
  });

  logger.debug('metadata', {
    data: {
      record: metadata,
      rff_id: Number(metadata.rff_id),
      sig: toBytes(signature),
    },
    signature,
  });

  const rffIDN = Number(metadata.rff_id);
  // @ts-expect-error
  metadata.rff_id = undefined;

  const res = await metadataAxios<{ value: number }>({
    data: {
      record: metadata,
      rff_id: rffIDN,
      sig: toBytes(signature),
    },
    method: 'POST',
    url: `/api/v1/save-metadata/${rffIDN === 0 ? 'unlinked' : 'linked'}`,
  });

  return rffIDN === 0 ? res.data.value : rffIDN;
};

/**
 * Builds an ERC20 sweep batch: approve the Sweeper for `tokenAddress` (if not already
 * approved), then call `Sweeper.sweepERC20(tokenAddress, receiver)` to drain the sender's
 * balance to the receiver. The Sweeper at SWEEPER_ADDRESS pulls from `msg.sender`, so the
 * sender at execution time must equal `sender` in the cache lookup (Calibur wrapper on 7702
 * chains, Safe proxy on non-Pectra chains — both work because the call chain
 * `Safe.execTransaction → MultiSendCallOnly DELEGATECALL → CALL Sweeper` results in
 * `msg.sender` at the Sweeper being the wrapper address).
 *
 * Native sweeping is intentionally not supported here. The destination-swap path routes
 * aggregator output directly to the user's EOA (see route.ts `dstSwapRecipientInBytes`), so
 * native dust never accrues at the wrapper. If `tokenAddress` resolves to a native address,
 * we throw — that indicates a caller bug; the caller should not be sweeping native.
 */
export const createSweeperTxs = ({
  cache,
  chainID,
  COTCurrencyID,
  receiver,
  sender,
  tokenAddress,
}: {
  cache: Cache;
  chainID: number;
  COTCurrencyID: CurrencyID;
  receiver: Hex;
  sender: Hex;
  tokenAddress?: Hex;
}) => {
  if (!tokenAddress) {
    const currency = ChaindataMap.get(
      new OmniversalChainID(Universe.ETHEREUM, chainID)
    )!.Currencies.find((c) => c.currencyID === COTCurrencyID);

    if (!currency) {
      throw Errors.internal(`cot not found on chain ${chainID}`);
    }

    tokenAddress = convertToEVMAddress(currency.tokenAddress);
  }

  if (isNativeAddress(tokenAddress)) {
    throw Errors.internal(
      'createSweeperTxs called with native token address; native sweeping is not supported (aggregator should deliver native output directly to EOA)'
    );
  }

  const txs: Tx[] = [];
  const sweeperAllowance = cache.getAllowance({
    chainID: Number(chainID),
    contractAddress: convertToEVMAddress(tokenAddress),
    owner: sender,
    spender: SWEEPER_ADDRESS,
  });

  if (!sweeperAllowance || sweeperAllowance === 0n) {
    txs.push({
      data: packERC20Approve(SWEEPER_ADDRESS, maxUint256),
      to: convertToEVMAddress(tokenAddress),
      value: 0n,
    });
  }
  txs.push({
    data: encodeFunctionData({
      abi: SWEEP_ABI,
      args: [convertToEVMAddress(tokenAddress), receiver],
      functionName: 'sweepERC20',
    }),
    to: SWEEPER_ADDRESS,
    value: 0n,
  });

  return txs;
};

export const performDestinationSwap = async ({
  actualAddress,
  cache,
  calls,
  chain,
  chainList,
  COT,
  destinationExecution,
  emitter,
  hasDestinationSwap,
  publicClientList,
  signerWallet,
  vscClient,
}: {
  actualAddress: Hex;
  cache: Cache;
  calls: Tx[];
  chain: Chain;
  chainList: ChainListType;
  COT: CurrencyID;
  destinationExecution: DestinationExecution;
  emitter: {
    emit: (step: SwapStepType) => void;
  };
  hasDestinationSwap: boolean;
  publicClientList: PublicClientList;
  signerWallet: PrivateKeyAccount;
  vscClient: VSCClient;
}) => {
  if (destinationExecution.mode === 'direct_eoa') {
    throw new Error(
      'performDestinationSwap must not be called for direct_eoa destination execution'
    );
  }

  // If destination swap token is COT then calls is an empty array,
  // sweeper txs will send from destination execution account -> eoa, other cases it sweeps the dust
  const batchCalls = calls.concat(
    createSweeperTxs({
      cache,
      chainID: chain.id,
      COTCurrencyID: COT,
      receiver: actualAddress,
      sender: destinationExecution.address,
    })
  );
  performance.mark('destination-swap-start');
  const ops =
    destinationExecution.mode === 'safe_account'
      ? [
          await (async () => {
            return vscClient.vscCreateSafeExecuteTx(
              await createSafeExecuteTxFromCalls({
                calls: batchCalls,
                chainId: chain.id,
                ephemeralWallet: signerWallet,
                publicClient: publicClientList.get(chain.id),
                safeAddress: destinationExecution.address,
              })
            );
          })(),
        ]
      : await vscClient.vscSBCTx([
          await createSBCTxFromCalls({
            cache,
            calls: batchCalls,
            chainID: chain.id,
            ephemeralAddress: destinationExecution.address,
            ephemeralWallet: signerWallet,
            publicClient: publicClientList.get(chain.id),
          }),
        ]);
  performance.mark('destination-swap-end');

  if (hasDestinationSwap) {
    emitter.emit(SWAP_STEPS.DESTINATION_SWAP_HASH(ops[0], chainList));
  }

  performance.mark('destination-swap-mining-start');
  await waitForSBCTxReceipt(ops, chainList, publicClientList);
  performance.mark('destination-swap-mining-end');
  return ops[0][1];
};

export type SafeCotBalance = {
  chainID: number;
  tokenAddress: Hex;
};

/**
 * Direct balanceOf reads of the COT token on every Safe-mode chain (swap-supported but
 * pre-Pectra, so no 7702 → execution lives on a Safe). Cheaper than calling the VSC
 * `/swap-balances` endpoint, which fans out across all chains and tokens just so we can
 * throw most of it away. Returns one entry per chain where the Safe has non-zero COT.
 */
export const getSafeCotBalances = async ({
  chainList,
  COTCurrencyID,
  publicClientList,
  safeAddress,
}: {
  chainList: ChainListType;
  COTCurrencyID: CurrencyID;
  publicClientList: PublicClientList;
  safeAddress: Hex;
}): Promise<SafeCotBalance[]> => {
  const safeModeChains = chainList.chains.filter((c) => c.swapSupported && !c.pectraUpgradeSupport);

  const reads = await Promise.all(
    safeModeChains.map(async (chain) => {
      const currency = ChaindataMap.get(
        new OmniversalChainID(Universe.ETHEREUM, chain.id)
      )?.Currencies.find((c) => c.currencyID === COTCurrencyID);
      if (!currency) {
        return null;
      }
      const tokenAddress = convertToEVMAddress(currency.tokenAddress);
      try {
        const balance = await publicClientList.get(chain.id).readContract({
          abi: ERC20ABI,
          address: tokenAddress,
          functionName: 'balanceOf',
          args: [safeAddress],
        });
        if (balance === 0n) {
          return null;
        }
        return { chainID: chain.id, tokenAddress };
      } catch (e) {
        logger.error('error reading COT balance on safe chain', e, {
          cause: 'SAFE_COT_BALANCE_READ_ERROR',
          chainID: chain.id,
        });
        return null;
      }
    })
  );

  return reads.filter((b): b is SafeCotBalance => b !== null);
};

export const sweepCotBalancesToEoa = async ({
  ephemeralBalances,
  safeCotBalances,
  chainList,
  COTCurrencyID,
  eoaAddress,
  ephemeralAddress,
  safeAddress,
  ephemeralWallet,
  publicClientList,
  vscClient,
}: {
  ephemeralBalances: FlatBalance[];
  safeCotBalances: SafeCotBalance[];
  chainList: ChainListType;
  COTCurrencyID: CurrencyID;
  eoaAddress: Hex;
  ephemeralAddress: Hex;
  safeAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  publicClientList: PublicClientList;
  vscClient: VSCClient;
}) => {
  const cotSymbol = CurrencyID[COTCurrencyID];
  // SBC/7702 chains: COT sits on the ephemeral wallet. Re-filter here because the caller
  // passes the full ephemeral balance set.
  const sbcCotBalances = ephemeralBalances.filter(
    (b) =>
      b.universe === Universe.ETHEREUM &&
      equalFold(b.symbol, cotSymbol) &&
      new Decimal(b.amount).gt(0)
  );

  if (sbcCotBalances.length === 0 && safeCotBalances.length === 0) {
    return;
  }

  const cache = new Cache(publicClientList);
  for (const balance of sbcCotBalances) {
    const tokenAddress = convertToEVMAddress(balance.tokenAddress);
    cache.addSetCodeQuery({
      address: ephemeralAddress,
      chainID: balance.chainID,
    });
    cache.addAllowanceQuery({
      chainID: balance.chainID,
      contractAddress: tokenAddress,
      owner: ephemeralAddress,
      spender: SWEEPER_ADDRESS,
    });
  }
  for (const balance of safeCotBalances) {
    cache.addAllowanceQuery({
      chainID: balance.chainID,
      contractAddress: balance.tokenAddress,
      owner: safeAddress,
      spender: SWEEPER_ADDRESS,
    });
  }

  await cache.process();

  const sbcTxs = (
    await Promise.all(
      sbcCotBalances.map(async (balance) => {
        const tokenAddress = convertToEVMAddress(balance.tokenAddress);
        try {
          return await createSBCTxFromCalls({
            cache,
            calls: createSweeperTxs({
              cache,
              chainID: balance.chainID,
              COTCurrencyID,
              receiver: eoaAddress,
              sender: ephemeralAddress,
              tokenAddress,
            }),
            chainID: balance.chainID,
            ephemeralAddress,
            ephemeralWallet,
            publicClient: publicClientList.get(balance.chainID),
          });
        } catch (e) {
          logger.error('error creating cot sweep tx', e, {
            cause: 'COT_SWEEP_TX_BUILD_ERROR',
            chainID: balance.chainID,
            tokenAddress: balance.tokenAddress,
          });
          return null;
        }
      })
    )
  ).filter((tx): tx is SBCTx => tx !== null);

  const safeTxs = (
    await Promise.all(
      safeCotBalances.map(async (balance) => {
        try {
          return await createSafeExecuteTxFromCalls({
            calls: createSweeperTxs({
              cache,
              chainID: balance.chainID,
              COTCurrencyID,
              receiver: eoaAddress,
              sender: safeAddress,
              tokenAddress: balance.tokenAddress,
            }),
            chainId: balance.chainID,
            ephemeralWallet,
            publicClient: publicClientList.get(balance.chainID),
            safeAddress,
          });
        } catch (e) {
          logger.error('error creating safe cot sweep tx', e, {
            cause: 'COT_SWEEP_TX_BUILD_ERROR',
            chainID: balance.chainID,
            tokenAddress: balance.tokenAddress,
          });
          return null;
        }
      })
    )
  ).filter((tx): tx is SafeExecuteTx => tx !== null);

  // SBC sweeps go in a single batched VSC call; each Safe sweep is its own VSC call
  // (vscCreateSafeExecuteTx is not batched). Run them concurrently with allSettled so a
  // single chain failure doesn't drop the rest.
  const sendPromises: Promise<[bigint, Hex][]>[] = [];
  if (sbcTxs.length > 0) {
    sendPromises.push(vscClient.vscSBCTx(sbcTxs));
  }
  for (const tx of safeTxs) {
    sendPromises.push(vscClient.vscCreateSafeExecuteTx(tx).then((op) => [op]));
  }

  const settled = await Promise.allSettled(sendPromises);
  const allOps: [bigint, Hex][] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      allOps.push(...r.value);
    } else {
      logger.error('cot sweep send failed', r.reason, {
        cause: 'COT_SWEEP_SEND_ERROR',
      });
    }
  }

  if (allOps.length > 0) {
    await waitForSBCTxReceipt(allOps, chainList, publicClientList);
  }
};

export const getSwapSupportedChains = (chainList: ChainListType) => {
  return chainList.chains
    .filter((chain) => chain.swapSupported)
    .map((chain) => ({
      id: chain.id,
      name: chain.name,
      logo: chain.custom.icon,
    }));
};

export { sortSourcesByPriority, sortSourcesByPriorityWithAsset } from './sort';
