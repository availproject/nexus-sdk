import type { Chain } from "@avail-project/nexus-core";
import { createWalletClient, getAddress, http, isHex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_MULTICALL_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

type HexString = `0x${string}`;

type RpcTransactionRequest = {
  from?: HexString;
  to?: HexString;
  data?: HexString;
  value?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string;
};

export const createPrivateKeyProvider = (params: {
  privateKey: HexString;
  chains: Chain[];
}) => {
  const { privateKey, chains } = params;
  const account = privateKeyToAccount(privateKey);
  const chainById = new Map(chains.map((chain) => [chain.id, chain]));
  const walletClients = new Map<
    number,
    ReturnType<typeof createWalletClient>
  >();
  let currentChainId = chains[0]?.id ?? 11155111;

  const getWalletClient = (chainId: number) => {
    const existing = walletClients.get(chainId);
    if (existing) return existing;

    const chain = chainById.get(chainId);
    if (!chain) {
      throw new Error(`Unsupported chain ${chainId}`);
    }

    const rpcUrl =
      chain.rpcUrls.default.http[0] ??
      chain.rpcUrls.default.publicHttp?.[0] ??
      chain.rpcUrls.default.grpc?.[0];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }

    const client = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
    walletClients.set(chainId, client);
    return client;
  };

  const request = async (args: {
    method: string;
    params?: unknown[] | object;
  }) => {
    const { method, params } = args;

    if (method === "eth_chainId") {
      return toHex(currentChainId);
    }

    if (method === "eth_accounts" || method === "eth_requestAccounts") {
      return [account.address];
    }

    if (
      method === "eth_signTypedData" ||
      method === "eth_signTypedData_v3" ||
      method === "eth_signTypedData_v4"
    ) {
      const rawParams = Array.isArray(params) ? params : [];
      const first = rawParams[0];
      const second = rawParams[1];
      const typedData = (() => {
        if (typeof first === "string" && first.trim().startsWith("{")) {
          return JSON.parse(first);
        }
        if (typeof second === "string" && second.trim().startsWith("{")) {
          return JSON.parse(second);
        }
        if (typeof first === "object" && first) return first;
        if (typeof second === "object" && second) return second;
        throw new Error("Invalid typed data payload");
      })();

      return account.signTypedData(typedData);
    }

    if (method === "personal_sign" || method === "eth_sign") {
      const rawParams = Array.isArray(params) ? params : [];
      const messageParam =
        method === "personal_sign" ? rawParams[0] : rawParams[1];
      const message =
        typeof messageParam === "string" && isHex(messageParam)
          ? ({ raw: messageParam } as { raw: HexString })
          : String(messageParam ?? "");
      return account.signMessage({ message });
    }

    if (method === "eth_sendTransaction") {
      const rawParams = Array.isArray(params) ? params : [];
      const tx = rawParams[0] as RpcTransactionRequest | undefined;
      if (!tx) {
        throw new Error("eth_sendTransaction: missing transaction params");
      }

      if (tx.from && getAddress(tx.from) !== account.address) {
        throw new Error(
          `eth_sendTransaction from ${tx.from} does not match configured account ${account.address}`,
        );
      }

      const client = getWalletClient(currentChainId);
      const sendTransaction = client.sendTransaction as (args: {
        account: typeof account;
        to?: HexString;
        data?: HexString;
        value?: bigint;
        gas?: bigint;
        gasPrice?: bigint;
        maxFeePerGas?: bigint;
        maxPriorityFeePerGas?: bigint;
        nonce?: number;
      }) => Promise<HexString>;

      return sendTransaction({
        account,
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
        gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
        maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas
          ? BigInt(tx.maxPriorityFeePerGas)
          : undefined,
        nonce: tx.nonce ? Number.parseInt(tx.nonce, 16) : undefined,
      });
    }

    if (method === "wallet_switchEthereumChain") {
      const target = Array.isArray(params)
        ? (params[0] as { chainId?: string })
        : undefined;
      const chainIdHex = target?.chainId;
      if (!chainIdHex) {
        throw new Error("wallet_switchEthereumChain missing chainId");
      }
      const chainId = Number.parseInt(chainIdHex, 16);
      if (!chainById.has(chainId)) {
        throw new Error(`Unsupported chain ${chainId}`);
      }
      currentChainId = chainId;
      return null;
    }

    if (method === "wallet_addEthereumChain") {
      const target = Array.isArray(params)
        ? (params[0] as {
            chainId?: string;
            rpcUrls?: string[];
            chainName?: string;
            nativeCurrency?: {
              name: string;
              symbol: string;
              decimals: number;
              logo?: string;
            };
            blockExplorerUrls?: string[];
            multicallAddress?: HexString;
          })
        : undefined;
      const chainIdHex = target?.chainId;
      if (!chainIdHex) {
        return null;
      }
      const chainId = Number.parseInt(chainIdHex, 16);
      if (!chainById.has(chainId) && target?.rpcUrls?.length) {
        const nativeCurrency = target.nativeCurrency
          ? { ...target.nativeCurrency, logo: target.nativeCurrency.logo ?? "" }
          : { name: "Native", symbol: "NATIVE", decimals: 18, logo: "" };

        chainById.set(chainId, {
          id: chainId,
          name: target.chainName ?? `Chain ${chainId}`,
          multicallAddress:
            target.multicallAddress ?? DEFAULT_MULTICALL_ADDRESS,
          nativeCurrency,
          rpcUrls: { default: { http: target.rpcUrls, webSocket: [] } },
          custom: { icon: "", knownTokens: [] },
          universe: 0,
          blockExplorers: target.blockExplorerUrls?.[0]
            ? {
                default: {
                  name: `${target.chainName ?? "Chain"} Explorer`,
                  url: target.blockExplorerUrls[0],
                },
              }
            : undefined,
        } as Chain);
      }
      currentChainId = chainId;
      return null;
    }

    const client = getWalletClient(currentChainId);
    const requestRpc = client.request as (args: {
      method: string;
      params?: unknown[] | object;
    }) => Promise<unknown>;
    return requestRpc({ method, params });
  };

  const provider = {
    request,
    on: (_event: string | symbol, _listener: (...args: any[]) => void) =>
      provider,
    removeListener: (
      _event: string | symbol,
      _listener: (...args: any[]) => void,
    ) => provider,
  };

  return { provider, address: account.address };
};
