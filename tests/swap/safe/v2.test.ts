import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  decodeFunctionData,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as rootModule from '../../../src';
import { safeSetupAbi } from '../../../src/swap/safe/abis';
import * as safeModule from '../../../src/swap/safe';

const EOA = '0x1111111111111111111111111111111111111111' as const;
const EPHEMERAL = '0x2222222222222222222222222222222222222222' as const;
const EXPECTED_SAFE = '0x9f2d0eCC82F642B92Ca3DadAC1022e0B858FA03B' as const;
const EXPECTED_SALT =
  0xf212cb2719449f0570d19f815f1568cdc3a7b90d9d64d5f47bae552fad9e2e94n;
const EXPECTED_IDENTIFIER =
  '0x5afe003863353064343636303538333931616562313764653466393238363165' as const;
const PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

type SafeV2Surface = {
  SAFE_V2_ON_CHAIN_IDENTIFIER: Hex;
  SAFE_V2_SALT_NONCE: bigint;
  buildSafeInitializerV2: (eoaAddress: Address, ephemeralAddress: Address) => Hex;
  createSafeClientV2: (options: {
    chainId: number;
    eoaAddress: Address;
    ephemeralOwner: ReturnType<typeof privateKeyToAccount>;
    publicClient: unknown;
    middleware: {
      getSafeAccountAddress: ReturnType<typeof vi.fn>;
      ensureSafeAccount: ReturnType<typeof vi.fn>;
      createSafeExecuteTx: ReturnType<typeof vi.fn>;
    };
  }) => {
    getAddress: () => Promise<{ address: Address; exists: boolean }>;
    ensure: (options?: { deadlineSeconds?: number }) => Promise<unknown>;
    execute: (call: { to: Address; value: bigint; data: Hex }) => Promise<unknown>;
    executeBatch: (
      calls: Array<{ to: Address; value: bigint; data: Hex }>
    ) => Promise<unknown>;
  };
  createSafeMiddlewareClientV2: (http: {
    post: ReturnType<typeof vi.fn>;
  }) => {
    getSafeAccountAddress: (request: unknown) => Promise<unknown>;
    ensureSafeAccount: (request: unknown) => Promise<unknown>;
    createSafeExecuteTx: (request: unknown) => Promise<unknown>;
  };
  normalizeSafeSignature: (signature: Hex) => Hex;
  predictSafeAccountAddressV2: (
    eoaAddress: Address,
    ephemeralAddress: Address
  ) => { address: Address; factoryAddress: Address; initializer: Hex };
  signEnsureAuthV2: (
    account: ReturnType<typeof privateKeyToAccount>,
    params: {
      chainId: bigint;
      eoaAddress: Address;
      ephemeralAddress: Address;
      safeAddress: Address;
      deadline: bigint;
    }
  ) => Promise<Hex>;
};

const v2 = safeModule as unknown as Partial<SafeV2Surface>;

const readTypeScriptSources = (directory: string): string =>
  readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readTypeScriptSources(path);
      return entry.name.endsWith('.ts') ? readFileSync(path, 'utf8') : '';
    })
    .join('\n');

describe('Safe V2 wire format', () => {
  it('matches the Protocol Kit golden address with EOA-first owner order and threshold 1', () => {
    expect(typeof v2.predictSafeAccountAddressV2).toBe('function');
    if (!v2.predictSafeAccountAddressV2) return;

    const result = v2.predictSafeAccountAddressV2(EOA, EPHEMERAL);
    expect(result.address).toBe(EXPECTED_SAFE);
    expect(result.initializer).toBe(v2.buildSafeInitializerV2?.(EOA, EPHEMERAL));

    const decoded = decodeFunctionData({ abi: safeSetupAbi, data: result.initializer });
    expect(decoded.functionName).toBe('setup');
    expect(decoded.args[0]).toEqual([EOA, EPHEMERAL]);
    expect(decoded.args[1]).toBe(1n);
  });

  it('pins the server-selected V2 salt and Avail Nexus SDK identifier', () => {
    expect(v2.SAFE_V2_SALT_NONCE).toBe(EXPECTED_SALT);
    expect(v2.SAFE_V2_ON_CHAIN_IDENTIFIER).toBe(EXPECTED_IDENTIFIER);
  });

  it('signs the V2 ensure authorization with both owners', async () => {
    expect(typeof v2.signEnsureAuthV2).toBe('function');
    if (!v2.signEnsureAuthV2 || !v2.predictSafeAccountAddressV2) return;

    const ephemeralOwner = privateKeyToAccount(PRIVATE_KEY);
    const safeAddress = v2.predictSafeAccountAddressV2(EOA, ephemeralOwner.address).address;
    const deadline = 4_102_444_800n;
    const signature = await v2.signEnsureAuthV2(ephemeralOwner, {
      chainId: 1n,
      eoaAddress: EOA,
      ephemeralAddress: ephemeralOwner.address,
      safeAddress,
      deadline,
    });
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: 'NexusSafeEnsureAuth',
        version: '2',
        chainId: 1n,
        verifyingContract: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
      },
      types: {
        NexusSafeEnsureV2: [
          { name: 'eoaAddress', type: 'address' },
          { name: 'ephemeralAddress', type: 'address' },
          { name: 'safeAddress', type: 'address' },
          { name: 'saltNonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'NexusSafeEnsureV2',
      message: {
        eoaAddress: EOA,
        ephemeralAddress: ephemeralOwner.address,
        safeAddress,
        saltNonce: EXPECTED_SALT,
        deadline,
      },
      signature,
    });
    expect(recovered).toBe(ephemeralOwner.address);
  });

  it('normalizes Safe signatures to a 65-byte 27/28 recovery byte', () => {
    const normalizeSafeSignature = v2.normalizeSafeSignature;
    expect(typeof normalizeSafeSignature).toBe('function');
    if (!normalizeSafeSignature) return;

    const signature = `0x${'11'.repeat(64)}00` as Hex;
    expect(normalizeSafeSignature(signature)).toBe(`0x${'11'.repeat(64)}1b`);
    expect(() => normalizeSafeSignature(`0x${'11'.repeat(64)}` as Hex)).toThrow(/65-byte/);
  });

  it('posts Citrea requests only to /api/v2 Safe endpoints', async () => {
    expect(typeof v2.createSafeMiddlewareClientV2).toBe('function');
    if (!v2.createSafeMiddlewareClientV2) return;

    const post = vi.fn().mockResolvedValue({ data: { ok: true } });
    const client = v2.createSafeMiddlewareClientV2({ post });
    const addressRequest = { chainId: 4114, eoaAddress: EOA, ephemeralAddress: EPHEMERAL };
    const ensureRequest = {
      ...addressRequest,
      safeAddress: EXPECTED_SAFE,
      deadline: '4102444800',
      signature: `0x${'11'.repeat(65)}` as Hex,
    };
    const executeRequest = {
      ...addressRequest,
      safeAddress: EXPECTED_SAFE,
      to: EOA,
      value: '0',
      data: '0x' as Hex,
      operation: 0 as const,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000' as const,
      refundReceiver: '0x0000000000000000000000000000000000000000' as const,
      nonce: '0',
      signature: `0x${'11'.repeat(65)}` as Hex,
    };

    await client.getSafeAccountAddress(addressRequest);
    await client.ensureSafeAccount(ensureRequest);
    await client.createSafeExecuteTx(executeRequest);

    expect(post.mock.calls.map(([url]) => url)).toEqual([
      '/api/v2/get-safe-account-address',
      '/api/v2/ensure-safe-account',
      '/api/v2/create-safe-execute-tx',
    ]);
    expect(post.mock.calls.map(([, body]) => body.chainId)).toEqual([4114, 4114, 4114]);
  });

  it('serializes sponsored V2 execution numeric fields as decimal strings', async () => {
    expect(typeof v2.createSafeClientV2).toBe('function');
    if (!v2.createSafeClientV2 || !v2.predictSafeAccountAddressV2) return;

    const ephemeralOwner = privateKeyToAccount(PRIVATE_KEY);
    const safeAddress = v2.predictSafeAccountAddressV2(EOA, ephemeralOwner.address).address;
    const middleware = {
      getSafeAccountAddress: vi.fn(),
      ensureSafeAccount: vi.fn(),
      createSafeExecuteTx: vi.fn().mockResolvedValue({
        chainId: 1,
        safeAddress,
        txHash: `0x${'22'.repeat(32)}`,
      }),
    };
    const client = v2.createSafeClientV2({
      chainId: 1,
      eoaAddress: EOA,
      ephemeralOwner,
      publicClient: {
        getCode: vi.fn().mockResolvedValue('0x1234'),
        readContract: vi.fn().mockResolvedValue(7n),
      },
      middleware,
    });

    await client.execute({ to: EOA, value: 12n, data: '0xdeadbeef' });

    const request = middleware.createSafeExecuteTx.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      chainId: 1,
      eoaAddress: EOA,
      ephemeralAddress: ephemeralOwner.address,
      safeAddress,
      value: '12',
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      nonce: '7',
    });
    expect(request.signature).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it('checks the predicted V2 address locally and sends both owners when ensuring it', async () => {
    expect(typeof v2.createSafeClientV2).toBe('function');
    if (!v2.createSafeClientV2 || !v2.predictSafeAccountAddressV2) return;

    const ephemeralOwner = privateKeyToAccount(PRIVATE_KEY);
    const safeAddress = v2.predictSafeAccountAddressV2(EOA, ephemeralOwner.address).address;
    const getCode = vi.fn().mockResolvedValue(undefined);
    const middleware = {
      getSafeAccountAddress: vi.fn(),
      ensureSafeAccount: vi.fn().mockResolvedValue({
        chainId: 1,
        eoaAddress: EOA,
        ephemeralAddress: ephemeralOwner.address,
        address: safeAddress,
        factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
        exists: true,
      }),
      createSafeExecuteTx: vi.fn(),
    };
    const client = v2.createSafeClientV2({
      chainId: 1,
      eoaAddress: EOA,
      ephemeralOwner,
      publicClient: { getCode, readContract: vi.fn() },
      middleware,
    });

    await expect(client.getAddress()).resolves.toEqual({ address: safeAddress, exists: false });
    await client.ensure({ deadlineSeconds: 600 });

    expect(getCode).toHaveBeenCalledWith({ address: safeAddress });
    expect(middleware.ensureSafeAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 1,
        eoaAddress: EOA,
        ephemeralAddress: ephemeralOwner.address,
        safeAddress,
        deadline: expect.stringMatching(/^\d+$/),
        signature: expect.stringMatching(/^0x[0-9a-f]{130}$/i),
      })
    );
    expect(middleware.ensureSafeAccount.mock.calls[0]?.[0]).not.toHaveProperty('saltNonce');
  });

  it('wraps V2 batches with MultiSendCallOnly and a decimal nonce', async () => {
    expect(typeof v2.createSafeClientV2).toBe('function');
    if (!v2.createSafeClientV2 || !v2.predictSafeAccountAddressV2) return;

    const ephemeralOwner = privateKeyToAccount(PRIVATE_KEY);
    const safeAddress = v2.predictSafeAccountAddressV2(EOA, ephemeralOwner.address).address;
    const middleware = {
      getSafeAccountAddress: vi.fn(),
      ensureSafeAccount: vi.fn(),
      createSafeExecuteTx: vi.fn().mockResolvedValue({
        chainId: 1,
        safeAddress,
        txHash: `0x${'22'.repeat(32)}`,
      }),
    };
    const client = v2.createSafeClientV2({
      chainId: 1,
      eoaAddress: EOA,
      ephemeralOwner,
      publicClient: {
        getCode: vi.fn(),
        readContract: vi.fn().mockResolvedValue(3n),
      },
      middleware,
    });

    await client.executeBatch([
      { to: EOA, value: 0n, data: '0xaa' },
      { to: EPHEMERAL, value: 0n, data: '0xbb' },
    ]);

    expect(middleware.createSafeExecuteTx).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 1,
        to: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
        nonce: '3',
      })
    );
  });

  it('rejects an empty V2 batch before signing or calling middleware', async () => {
    expect(typeof v2.createSafeClientV2).toBe('function');
    if (!v2.createSafeClientV2) return;

    const middleware = {
      getSafeAccountAddress: vi.fn(),
      ensureSafeAccount: vi.fn(),
      createSafeExecuteTx: vi.fn(),
    };
    const client = v2.createSafeClientV2({
      chainId: 1,
      eoaAddress: EOA,
      ephemeralOwner: privateKeyToAccount(PRIVATE_KEY),
      publicClient: {
        getCode: vi.fn(),
        readContract: vi.fn().mockResolvedValue(0n),
      },
      middleware,
    });

    await expect(client.executeBatch([])).rejects.toThrow(/must not be empty/);
    expect(middleware.createSafeExecuteTx).not.toHaveBeenCalled();
  });

  it('keeps Protocol Kit out of SDK dependencies and source imports', () => {
    const repositoryRoot = resolve(import.meta.dirname, '../../..');
    const manifest = readFileSync(join(repositoryRoot, 'package.json'), 'utf8');
    const source = readTypeScriptSources(join(repositoryRoot, 'src'));

    expect(manifest).not.toContain('@safe-global/protocol-kit');
    expect(source).not.toMatch(/(?:from\s+|import\s*\()(['"])@safe-global\/protocol-kit/);
  });

  it('keeps active swap code off the legacy single-owner predictor', () => {
    const repositoryRoot = resolve(import.meta.dirname, '../../..');
    const highLevelSafeUsers = [
      'src/services/safe.ts',
      'src/swap/prepare.ts',
      'src/swap/routing/addresses.ts',
      'src/swap/execution/bridge.ts',
      'src/swap/execution/destination-swap.ts',
      'src/swap/execution/direct-destination.ts',
      'src/swap/execution/failure-cleanup.ts',
      'src/swap/execution/safe-dispatch.ts',
      'src/swap/execution/source-swaps.ts',
    ].map((path) => readFileSync(join(repositoryRoot, path), 'utf8'));

    expect(highLevelSafeUsers.join('\n')).not.toMatch(/\bpredictSafeAccountAddress\(/);
  });

  it('confines legacy Safe recovery to the initialization refund sweep', () => {
    const repositoryRoot = resolve(import.meta.dirname, '../../..');
    const initRefundSweep = readFileSync(
      join(repositoryRoot, 'src/services/init-refund-sweep.ts'),
      'utf8'
    );

    expect(initRefundSweep.match(/\bpredictSafeAccountAddress\(/g)).toHaveLength(1);
    expect(initRefundSweep.match(/\bcreateSafeClient\(/g)).toHaveLength(1);
  });

  it('passes the derived V2 Safe through routing and execution without re-deriving it', () => {
    const repositoryRoot = resolve(import.meta.dirname, '../../..');
    const safeConsumers = [
      'src/swap/prepare.ts',
      'src/swap/routing/addresses.ts',
      'src/swap/execution/bridge.ts',
      'src/swap/execution/destination-swap.ts',
      'src/swap/execution/direct-destination.ts',
      'src/swap/execution/failure-cleanup.ts',
      'src/swap/execution/safe-dispatch.ts',
      'src/swap/execution/source-swaps.ts',
    ].map((path) => readFileSync(join(repositoryRoot, path), 'utf8'));

    expect(safeConsumers.join('\n')).not.toMatch(
      /predictSafeAccountAddressV2|readCachedSafeAddress/
    );
  });
});
