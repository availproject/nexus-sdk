import { EventEmitter } from "events";
import { ethers } from "ethers";
import type {
  EthereumProvider,
  RequestArguments,
} from "@avail-project/nexus-core";

type HexString = `0x${string}`;

/**
 * Minimal EIP-1193 wrapper around an ethers Wallet.
 * Allows the Nexus SDK to operate in a backend (Node) environment by
 * emulating an injected provider.
 */
export class WalletEip1193Provider
  extends EventEmitter
  implements EthereumProvider {
  private wallet: ethers.Wallet;
  private rpcProvider: ethers.JsonRpcProvider;
  private cachedChainId?: bigint;

  constructor(wallet: ethers.Wallet) {
    super();

    if (!wallet.provider) {
      throw new Error("Wallet must be connected to a provider");
    }

    if (!(wallet.provider instanceof ethers.JsonRpcProvider)) {
      throw new Error("Wallet provider must be JsonRpcProvider");
    }

    this.wallet = wallet;
    this.rpcProvider = wallet.provider;
  }

  async request(args: RequestArguments): Promise<unknown> {
    const { method, params } = args;
    const paramArray = Array.isArray(params) ? params : params ? [params] : [];

    switch (method) {
      case "eth_chainId":
        return this.getHexChainId();

      case "eth_accounts":
      case "eth_requestAccounts":
        return [this.wallet.address];

      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        await this.handleChainSwitch(paramArray[0]);
        return null;

      case "eth_sendTransaction":
        return this.handleSendTransaction(paramArray[0]);

      case "eth_sign":
      case "personal_sign":
        return this.handlePersonalOrEthSign(method, paramArray);

      case "eth_signTypedData_v4":
        return this.handleSignTypedDataV4(paramArray);

      case "eth_getBalance":
      case "eth_getTransactionReceipt":
      case "eth_getTransactionByHash":
      case "eth_blockNumber":
      case "eth_call":
      case "eth_estimateGas":
        return this.rpcProvider.send(method, paramArray);

      default:
        // Defer unhandled methods to the underlying provider.
        return this.rpcProvider.send(method, paramArray);
    }
  }

  private async getHexChainId(): Promise<HexString> {
    if (this.cachedChainId === undefined) {
      const network = await this.rpcProvider.getNetwork();
      this.cachedChainId = network.chainId;
    }

    return ethers.toBeHex(this.cachedChainId) as HexString;
  }

  private getRpcUrlForChain(chainId: number): string | null {
    switch (chainId) {
      case 1: // Ethereum
        return "https://eth.merkle.io";
      case 84532: // Base Sepolia
        return "https://sepolia.base.org";
      case 421614: // Arbitrum Sepolia
        return "https://sepolia-rollup.arbitrum.io/rpc";
      case 10143:
        return "https://testnet-rpc.monad.xyz/";
      case 11155111:
        return "https://sepolia.drpc.org";
      case 11155420:
        return "https://sepolia.optimism.io";
      default:
        return null;
    }
  }

  private async handleChainSwitch(param: unknown): Promise<void> {
    const requested = (param as { chainId?: string })?.chainId;
    if (!requested) {
      throw new Error("wallet_switchEthereumChain requires chainId");
    }

    const targetChainId = Number(BigInt(requested));

    if (this.cachedChainId === undefined) {
      await this.getHexChainId();
    }

    if (Number(this.cachedChainId) === targetChainId) {
      return; // already on requested chain
    }

    const rpcUrl = this.getRpcUrlForChain(targetChainId);
    if (!rpcUrl) {
      const error = `wallet_switchEthereumChain: no RPC configured for chain ${targetChainId}, keeping existing provider`;
      console.error(error);
      throw new Error(error)
    }

    const newProvider = new ethers.JsonRpcProvider(rpcUrl);
    this.rpcProvider = newProvider;
    this.wallet = this.wallet.connect(newProvider);
    this.cachedChainId = undefined;
    await this.getHexChainId();
  }

  private async handleSendTransaction(rawTx: Record<string, unknown>) {
    if (!rawTx) {
      throw new Error("eth_sendTransaction requires a transaction object");
    }

    const txRequest: ethers.TransactionRequest = {
      to: (rawTx.to as string) ?? undefined,
      data: (rawTx.data as HexString) ?? undefined,
      value: rawTx.value ? BigInt(rawTx.value as string) : undefined,
      gasLimit: rawTx.gas
        ? BigInt(rawTx.gas as string)
        : rawTx.gasLimit
          ? BigInt(rawTx.gasLimit as string)
          : undefined,
      maxFeePerGas: rawTx.maxFeePerGas
        ? BigInt(rawTx.maxFeePerGas as string)
        : undefined,
      maxPriorityFeePerGas: rawTx.maxPriorityFeePerGas
        ? BigInt(rawTx.maxPriorityFeePerGas as string)
        : undefined,
      nonce: rawTx.nonce !== undefined ? Number(rawTx.nonce) : undefined,
    };

    const response = await this.wallet.sendTransaction(txRequest);
    return response.hash;
  }

  private async handlePersonalOrEthSign(
    method: string,
    params: unknown[],
  ): Promise<string> {
    if (params.length < 1) {
      throw new Error(`${method} requires parameters`);
    }

    // personal_sign order: [message, address]
    // eth_sign order: [address, message]
    const messageParam = method === "personal_sign" ? params[0] : params[1];

    const message =
      typeof messageParam === "string" && messageParam.startsWith("0x")
        ? ethers.getBytes(messageParam)
        : (messageParam as string);

    return this.wallet.signMessage(message);
  }

  private async handleSignTypedDataV4(params: unknown[]): Promise<string> {
    if (params.length < 2) {
      throw new Error("eth_signTypedData_v4 requires parameters");
    }

    const typedDataJson = params[1] as string;
    const parsed = JSON.parse(typedDataJson);
    const { domain, types, message } = parsed;

    const { EIP712Domain, ...typesWithoutDomain } = types;

    return this.wallet.signTypedData(domain, typesWithoutDomain, message);
  }
}

export const createEip1193Provider = (
  wallet: ethers.Wallet,
): EthereumProvider => {
  return new WalletEip1193Provider(wallet);
};
