import { spawnSync } from 'node:child_process';
import { encodePacked, keccak256, pad, parseEther, parseUnits, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { ChainListType, NetworkConfig } from '../../../../src/domain/types';

export type StressNetworkHint = 'testnet' | 'mainnet' | 'canary' | 'devnet';

export type StressNetworkConfig = Omit<NetworkConfig, 'NETWORK_HINT'> & {
  NETWORK_HINT: StressNetworkHint;
  CHAIN_RPC_OVERRIDES?: Record<string, string>;
};

const AUTO_FUND_TOKENS = new Set(['USDC', 'USDT']);
const ETH_FUNDING_AMOUNT = '1000';
const TOKEN_FUNDING_AMOUNT = '1000';

const runCastRpc = (rpcUrl: string, method: string, params: string[]) => {
  const result = spawnSync('cast', ['rpc', '--rpc-url', rpcUrl, method, ...params], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'unknown cast error';
    throw new Error(`cast rpc ${method} failed for ${rpcUrl}: ${detail}`);
  }
};

export const assertCastAvailable = () => {
  const result = spawnSync('cast', ['--version'], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      'Required dependency "cast" was not found. Install Foundry and ensure cast is available on PATH.'
    );
  }
};

export const applyChainRpcOverrides = (
  chainList: ChainListType,
  overrides?: Record<string, string>
): (() => void) => {
  if (!overrides || Object.keys(overrides).length === 0) return () => {};

  const originals = new Map<number, string[]>();
  for (const chain of chainList.chains) {
    const overrideUrl = overrides[String(chain.id)];
    if (!overrideUrl) continue;
    originals.set(chain.id, [...chain.rpcUrls.default.http]);
    chain.rpcUrls.default.http = [overrideUrl];
  }

  return () => {
    for (const chain of chainList.chains) {
      const original = originals.get(chain.id);
      if (!original) continue;
      chain.rpcUrls.default.http = original;
    }
  };
};

const resolveRpcUrl = (
  chainList: ChainListType,
  chainId: number,
  overrides?: Record<string, string>
): string => {
  const chain = chainList.getChainByID(chainId);
  if (!chain) {
    throw new Error(`Chain ${chainId} not found in deployment chain list.`);
  }
  const override = overrides?.[String(chainId)];
  const rpcUrl = override ?? chain.rpcUrls.default.http[0];
  if (!rpcUrl) {
    throw new Error(`No RPC URL available for chain ${chain.name} (${chain.id}).`);
  }
  return rpcUrl;
};

export const generateAndFundDevnetAccount = (params: {
  chainList: ChainListType;
  token: string;
  chainRpcOverrides?: Record<string, string>;
}): { privateKey: `0x${string}`; address: `0x${string}` } => {
  const tokenSymbol = params.token.toUpperCase();
  if (!AUTO_FUND_TOKENS.has(tokenSymbol)) {
    throw new Error(`Auto-funding supports only USDC/USDT. Received: ${params.token}`);
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  for (const chain of params.chainList.chains) {
    const rpcUrl = resolveRpcUrl(params.chainList, chain.id, params.chainRpcOverrides);

    const ethBalanceHex = toHex(parseEther(ETH_FUNDING_AMOUNT));
    runCastRpc(rpcUrl, 'anvil_setBalance', [account.address, ethBalanceHex]);

    const token = chain.custom.knownTokens.find(
      (entry) => entry.symbol.toUpperCase() === tokenSymbol
    );
    if (!token) {
      throw new Error(`Token ${tokenSymbol} not found on chain ${chain.id}.`);
    }
    if (token.balanceSlot === undefined) {
      throw new Error(`Missing knownTokens.balanceSlot for ${tokenSymbol} on chain ${chain.id}.`);
    }

    const tokenAmount = parseUnits(TOKEN_FUNDING_AMOUNT, token.decimals);
    const storageSlot = keccak256(
      encodePacked(
        ['bytes32', 'uint256'],
        [pad(account.address, { size: 32 }), BigInt(token.balanceSlot)]
      )
    );
    const storageValue = pad(toHex(tokenAmount), { size: 32 });
    runCastRpc(rpcUrl, 'anvil_setStorageAt', [token.contractAddress, storageSlot, storageValue]);
  }

  return {
    privateKey,
    address: account.address,
  };
};
