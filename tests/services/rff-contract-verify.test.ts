import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Decimal from 'decimal.js';
import { defineConfig } from 'hardhat/config';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import type { HardhatRuntimeEnvironment } from 'hardhat/types/hre';
import solc from 'solc';
import type { Abi, Hex } from 'viem';
import { createPublicClient, createWalletClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BridgeIntentDraft, BridgeOptions, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { createRequestFromIntent } from '../../src/services/rff';
import { makeChain, makeChainList } from '../helpers/chains';

type SolcOutput = {
  errors?: Array<{ severity: 'error' | 'warning'; formattedMessage: string }>;
  contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>>;
};

const PORT = 8546;
const RPC_URL = `http://127.0.0.1:${PORT}`;
const HARDHAT_FIRST_ACCOUNT_PK =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const hardhatConfig = defineConfig({});
const makeChainDisplay = (id: number, name: string) => ({ id, name, logo: `${name}.png` });
const NATIVE_TOKEN: TokenInfo = {
  contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  decimals: 18,
  logo: '',
  name: 'Ether',
  symbol: 'ETH',
};

describe('createRequestFromIntent + on-chain verifyRequest', () => {
  let hre: HardhatRuntimeEnvironment;
  let server: Awaited<ReturnType<HardhatRuntimeEnvironment['network']['createServer']>>;

  beforeAll(async () => {
    hre = await createHardhatRuntimeEnvironment(hardhatConfig, {});
    server = await hre.network.createServer(
      {
        override: {
          chainId: 31337,
          loggingEnabled: false,
        },
      },
      '127.0.0.1',
      PORT
    );
    await server.listen();
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  it('verifies SDK signature via deployed Solidity verifier', async () => {
    const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/contracts/SampleRequestVerifier.sol');
    const source = readFileSync(sourcePath, 'utf8');

    const input = {
      language: 'Solidity',
      sources: {
        'SampleRequestVerifier.sol': { content: source },
      },
      settings: {
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode'],
          },
        },
      },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
    const errors = output.errors?.filter((e) => e.severity === 'error') ?? [];
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
    }

    const contract = output.contracts['SampleRequestVerifier.sol']?.SampleRequestVerifier;
    if (!contract || !contract.evm.bytecode.object) {
      throw new Error('Failed to compile SampleRequestVerifier');
    }

    const abi = contract.abi;
    const bytecode = `0x${contract.evm.bytecode.object}` as Hex;

    const deployer = privateKeyToAccount(HARDHAT_FIRST_ACCOUNT_PK);
    const signer = privateKeyToAccount(generatePrivateKey());

    const walletClient = createWalletClient({
      account: deployer,
      chain: foundry,
      transport: http(RPC_URL),
    });
    const publicClient = createPublicClient({
      chain: foundry,
      transport: http(RPC_URL),
    });

    const deployTx = await walletClient.deployContract({
      abi,
      bytecode,
      account: deployer,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });
    if (!receipt.contractAddress) {
      throw new Error('Verifier deployment failed');
    }

    const token: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    };
    const sourceChain = makeChain(1, 'Ethereum');
    const destinationChain = makeChain(10, 'Optimism');
    const chainList = makeChainList([sourceChain, destinationChain], token);

    const intent: BridgeIntentDraft = {
      availableSources: [],
      recipientAddress: '0x0000000000000000000000000000000000000002',
      fees: {
        caGas: '0',
        deposit: '0',
        fulfillment: '0',
        protocol: '0',
        solver: '0',
      },
      selectedSources: [
        {
          amount: new Decimal('1.5'),
          amountRaw: 1500000n,
          chain: makeChainDisplay(sourceChain.id, sourceChain.name),
          token,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          value: new Decimal(0),
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
      ],
      destination: {
        amount: new Decimal('1.5'),
        amountRaw: 1500000n,
        chain: makeChainDisplay(destinationChain.id, destinationChain.name),
        nativeAmount: new Decimal('0.00000000000000005'),
        nativeAmountRaw: 50n,
        nativeAmountValue: new Decimal(0),
        nativeAmountInToken: new Decimal(0),
        nativeToken: NATIVE_TOKEN,
        token,
        universe: Universe.ETHEREUM,
        value: new Decimal(0),
      },
      provider: 'nexus',
    };

    const { requestHash, signature } = await createRequestFromIntent(intent, {
      evm: {
        address: signer.address,
        client: signer as unknown as BridgeOptions['evm']['client'],
      },
    });

    const [isValid] = (await publicClient.readContract({
      address: receipt.contractAddress,
      abi,
      functionName: 'verifyRequest',
      args: [signature, signer.address, requestHash],
    })) as readonly [boolean, Hex];
    expect(isValid).toBe(true);

    const [isValidWrongSigner] = (await publicClient.readContract({
      address: receipt.contractAddress,
      abi,
      functionName: 'verifyRequest',
      args: [signature, deployer.address, requestHash],
    })) as readonly [boolean, Hex];
    expect(isValidWrongSigner).toBe(false);
  }, 30_000);
});
