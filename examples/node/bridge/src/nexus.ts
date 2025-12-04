import {
  CHAIN_METADATA,
  NexusSDK,
  SUPPORTED_CHAINS,
  type BridgeParams,
  type UserAssetDatum,
} from "@avail-project/nexus-core";
import { createEip1193Provider } from "./eip1193Provider";
import { ethers } from "ethers";
import { exit } from "process";

let gSDK: NexusSDK | null = null;
let gSuccessCount: number = 0;
let gFailedCount: number = 0;

export class SDK {
  static async init() {
    let wallet;
    let provider;
    try {
      /// HERE USE YOUR OWN PRIVATE KEY
      wallet = new ethers.Wallet("YOUR PRIVATE KEY HERE", new ethers.InfuraProvider(undefined));
      provider = createEip1193Provider(wallet);
    } catch (e: any) {
      throw new Error(e)
    }

    try {
      const sdk = new NexusSDK({ network: "testnet" });
      await sdk.initialize(provider);
      gSDK = sdk;
    } catch (e: any) {
      throw new Error(e)
    }

    await logBridgeBalances()
    logBridgeParams()

    await SDK.bridge();
    console.log("All Good :)")
    exit(0)
  }

  static async getBalancesForBridge(): Promise<UserAssetDatum[] | string> {
    try {
      return await gSDK!.getBalancesForBridge();
    } catch (e: any) {
      const error =
        "Failed to fetch balances for swap. Reason: " + e.toString();
      return error;
    }
  }

  static getBridgeParams(): BridgeParams {
    const params: BridgeParams = {
      token: "USDC",
      amount: 1000n,
      toChainId: SUPPORTED_CHAINS.BASE_SEPOLIA,
    };

    return params;
  }

  static async bridge() {
    const sdk = gSDK!;
    const params = SDK.getBridgeParams();
    const result = await sdk.bridge(params);
    console.log(JSON.stringify(result))
  }

  static successCount(): number {
    return gSuccessCount
  }

  static failedCount(): number {
    return gFailedCount
  }

  static markSuccess(success: boolean) {
    if (success) {
      gSuccessCount += 1;
      const l = document.getElementById("successfulCount")! as HTMLLabelElement;
      l.textContent = "Successful Count: " + gSuccessCount;
      return;
    }

    gFailedCount += 1;
    const l = document.getElementById("failedCount")! as HTMLLabelElement;
    l.textContent = "Failed Count: " + gFailedCount;
    return;
  }
}

export async function logBridgeBalances(): Promise<
  UserAssetDatum[] | null
> {
  const balances = await SDK.getBalancesForBridge();
  if (typeof balances == "string") {
    throw new Error(balances)
    return null;
  }

  let pre = "Balance List:";
  for (const balance of balances) {
    pre += "\n\t" + balance.symbol + " Balance: " + balance.balance;
    for (const breakdown of balance.breakdown) {
      pre +=
        "\n\t\t" + breakdown.chain.name + ": " + breakdown.balance;
    }
  }
  console.log(pre)

  return balances;
}

export function logBridgeParams() {
  const params = SDK.getBridgeParams();
  let pre = "Bridge Params:";
  pre +=
    "\n\tAmount: " + params.amount + " (Units) " + params.token;
  pre += "\n\tChainId: " + params.toChainId;
  pre += "\n\tChain: " + CHAIN_METADATA[params.toChainId]!.name;
  console.log(pre)
}


function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}