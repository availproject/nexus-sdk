# V1 to V2 Middleware Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate SDK from V1 VSC msgpack WebSocket endpoints to V2 middleware REST/WebSocket JSON endpoints

**Architecture:** Replace msgpack-based VSC client with JSON-based middleware client. V1 uses WebSocket for all operations (balance, approvals, RFF creation). V2 uses REST for balance/RFF operations and WebSocket only for approvals. The middleware runs at localhost:3000 and proxies to statekeeper at localhost:9080.

**Tech Stack:** Existing viem, axios. Remove msgpack dependency for V2 paths. WebSocket remains for approvals but with JSON instead of msgpack.

---

## V1 → V2 API Mapping

| Operation | V1 VSC | V2 Middleware |
|-----------|--------|---------------|
| Get Balance | `GET /api/v1/get-balance/:namespace/:addr` (msgpack) | `GET /api/v1/balance/:universe/:addr` (JSON) |
| Create Approvals | `WSS /api/v1/create-sponsored-approvals` (msgpack) | `WSS /api/v1/create-sponsored-approvals` (JSON) |
| Create RFF | Cosmos submit + `WSS /api/v1/create-rff` (msgpack) | `POST /api/v1/rff` (JSON to statekeeper) |
| Get RFF | Cosmos query | `GET /api/v1/rff/:hash` (JSON from statekeeper) |
| List RFFs | Cosmos query | `GET /api/v1/rffs?user=...` (JSON from statekeeper) |

**Key Differences:**
- V1 balance response: `{ balances: [{ chain_id: Uint8Array, currencies: [...] }] }`
- V2 balance response: `{ "42161": { currencies: [...], total_usd, universe, errored } }`
- V1 approvals: msgpack with Uint8Array addresses
- V2 approvals: JSON with hex string addresses and chainId-keyed structure
- V1 RFF: Multi-step Cosmos + VSC WebSocket
- V2 RFF: Single POST to middleware → statekeeper

---

## Task 1: Add Middleware URL to NetworkConfig

**Files:**
- Modify: `src/commons/types/index.ts:410-420`
- Modify: `src/sdk/ca-base/config.ts:10-42`

**Step 1: Add MIDDLEWARE_URL to NetworkConfig type**

```typescript
export type NetworkConfig = {
  COSMOS_URL: string;
  EXPLORER_URL: string;
  GRPC_URL: string;
  NETWORK_HINT: Environment;
  VSC_DOMAIN: string;
  STATEKEEPER_URL: string;
  MIDDLEWARE_URL: string;  // NEW
};
```

**Step 2: Add middleware URLs to environment configs**

```typescript
export const JADE: NetworkConfig = {
  COSMOS_URL: 'https://cosmos-jade.avail.so',
  EXPLORER_URL: 'https://folly-explorer.avail.tools',
  GRPC_URL: 'https://grpc-jade.avail.so',
  NETWORK_HINT: Environment.Testnet,
  VSC_DOMAIN: 'vsc-mainnet.availproject.org',
  STATEKEEPER_URL: 'http://localhost:9080',
  MIDDLEWARE_URL: 'http://localhost:3000',  // NEW
};
```

Repeat for CORAL and FOLLY configs.

**Step 3: Commit**

```bash
git add src/commons/types/index.ts src/sdk/ca-base/config.ts
git commit -m "feat: add MIDDLEWARE_URL to NetworkConfig"
```

---

## Task 2: Add V2 Middleware Types

**Files:**
- Create: `src/commons/types/middleware-types.ts`
- Modify: `src/commons/types/index.ts` (add export)

**Step 1: Create middleware type definitions**

```typescript
import { Hex } from 'viem';

export interface V2BalanceResponse {
  [chainId: string]: {
    currencies: {
      balance: string;
      token_address: string;
      value: string;
    }[];
    total_usd: string;
    universe: number;
    errored: boolean;
  };
}

export interface V2ApprovalOperation {
  tokenAddress: Hex;
  variant: 1 | 2;
  value: Hex | null;
  signature: {
    v: number;
    r: Hex;
    s: Hex;
  };
}

export interface V2ApprovalRequest {
  address: Hex;
  ops: V2ApprovalOperation[];
}

export type V2ApprovalsByChain = Record<number, V2ApprovalRequest[]>;

export interface V2ApprovalResponse {
  chainId: number;
  address: Hex;
  errored: boolean;
  txHash?: Hex;
  message?: string;
}

export interface V2MiddlewareRffRequest {
  sources: {
    universe: string;
    chain_id: string;
    contract_address: string;
    value: string;
    fee: string;
  }[];
  destination_universe: string;
  destination_chain_id: string;
  recipient_address: string;
  destinations: {
    contract_address: string;
    value: string;
  }[];
  nonce: string;
  expiry: string;
  parties: {
    universe: string;
    address: string;
  }[];
}

export interface V2MiddlewareRffPayload {
  request: V2MiddlewareRffRequest;
  signature: Hex;
}
```

**Step 2: Export from index**

In `src/commons/types/index.ts`, add:

```typescript
export * from './middleware-types';
```

**Step 3: Commit**

```bash
git add src/commons/types/middleware-types.ts src/commons/types/index.ts
git commit -m "feat: add V2 middleware type definitions"
```

---

## Task 3: Create Middleware Client

**Files:**
- Create: `src/sdk/ca-base/utils/middleware.utils.ts`

**Step 1: Create middleware client with balance fetching**

```typescript
import axios, { AxiosInstance } from 'axios';
import { Hex } from 'viem';
import {
  V2BalanceResponse,
  V2ApprovalsByChain,
  V2ApprovalResponse,
  V2MiddlewareRffPayload,
  V2RffResponse,
  ListRffsResponse,
  getLogger,
} from '../../../commons';
import { Errors } from '../errors';

const logger = getLogger();

let middlewareClient: AxiosInstance | null = null;

const getMiddlewareClient = (middlewareUrl: string) => {
  if (!middlewareClient) {
    middlewareClient = axios.create({
      baseURL: `${middlewareUrl}/api/v1`,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  }
  return middlewareClient;
};

export const getBalancesFromMiddleware = async (
  middlewareUrl: string,
  address: Hex,
  universe: 'evm' | 'tron' = 'evm',
): Promise<V2BalanceResponse> => {
  try {
    const response = await getMiddlewareClient(middlewareUrl).get<V2BalanceResponse>(
      `/balance/${universe}/${address}`,
    );
    logger.debug('getBalancesFromMiddleware', { response: response.data });
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch balances from middleware', error);
    throw Errors.internal('Failed to fetch balances from middleware');
  }
};

export const submitRffToMiddleware = async (
  middlewareUrl: string,
  payload: V2MiddlewareRffPayload,
): Promise<Hex> => {
  try {
    const response = await getMiddlewareClient(middlewareUrl).post<{ request_hash: Hex }>(
      '/rff',
      payload,
    );
    logger.debug('submitRffToMiddleware', { response: response.data });
    return response.data.request_hash;
  } catch (error) {
    logger.error('Failed to submit RFF to middleware', error);
    throw Errors.internal('Failed to submit RFF to middleware');
  }
};

export const getRffFromMiddleware = async (
  middlewareUrl: string,
  hash: Hex,
): Promise<V2RffResponse> => {
  try {
    const response = await getMiddlewareClient(middlewareUrl).get<V2RffResponse>(`/rff/${hash}`);
    logger.debug('getRffFromMiddleware', { response: response.data });
    return response.data;
  } catch (error) {
    logger.error('Failed to get RFF from middleware', error);
    throw Errors.internal('Failed to get RFF from middleware');
  }
};

export const listRffsFromMiddleware = async (
  middlewareUrl: string,
  params: {
    user?: Hex;
    status?: string;
    deposited?: boolean;
    fulfilled?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ListRffsResponse> => {
  try {
    const queryParams = new URLSearchParams();
    if (params.user) queryParams.append('user', params.user);
    if (params.status) queryParams.append('status', params.status);
    if (params.deposited !== undefined) queryParams.append('deposited', params.deposited.toString());
    if (params.fulfilled !== undefined) queryParams.append('fulfilled', params.fulfilled.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.offset) queryParams.append('offset', params.offset.toString());

    const url = `/rffs${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await getMiddlewareClient(middlewareUrl).get<ListRffsResponse>(url);
    logger.debug('listRffsFromMiddleware', { response: response.data });
    return response.data;
  } catch (error) {
    logger.error('Failed to list RFFs from middleware', error);
    throw Errors.internal('Failed to list RFFs from middleware');
  }
};

export const createApprovalsViaMiddleware = async (
  middlewareUrl: string,
  approvals: V2ApprovalsByChain,
): Promise<V2ApprovalResponse[]> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${middlewareUrl.replace('http', 'ws')}/api/v1/create-sponsored-approvals`);
    const results: V2ApprovalResponse[] = [];
    const totalExpected = Object.values(approvals).flat().length;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket timeout waiting for approvals'));
    }, 120000);

    ws.onopen = () => {
      logger.debug('WebSocket connected for approvals');
      ws.send(JSON.stringify(approvals));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === 'connected') {
        logger.debug('Received connection confirmation');
        return;
      }

      results.push(data as V2ApprovalResponse);
      logger.debug('Received approval response', { data, count: results.length, expected: totalExpected });

      if (results.length === totalExpected) {
        clearTimeout(timeout);
        ws.close();
        resolve(results);
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      logger.error('WebSocket error', error);
      reject(new Error('WebSocket error during approvals'));
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      if (results.length < totalExpected) {
        reject(new Error(`WebSocket closed before all approvals received (${results.length}/${totalExpected})`));
      }
    };
  });
};
```

**Step 2: Commit**

```bash
git add src/sdk/ca-base/utils/middleware.utils.ts
git commit -m "feat: add middleware client utilities"
```

---

## Task 4: Add Balance Adapter Function

**Files:**
- Modify: `src/sdk/ca-base/utils/middleware.utils.ts`

**Step 1: Add V2 to V1 balance format adapter**

```typescript
import { UnifiedBalanceResponseData } from '../../../commons';

export const adaptV2BalanceToV1Format = (
  v2Response: V2BalanceResponse,
): UnifiedBalanceResponseData[] => {
  const result: UnifiedBalanceResponseData[] = [];

  for (const [chainIdStr, chainData] of Object.entries(v2Response)) {
    const chainId = parseInt(chainIdStr, 10);
    const chainIdBytes = new Uint8Array(32);
    const chainIdBigInt = BigInt(chainId);

    for (let i = 0; i < 32; i++) {
      chainIdBytes[31 - i] = Number((chainIdBigInt >> BigInt(i * 8)) & 0xFFn);
    }

    const currencies = chainData.currencies.map(c => {
      const tokenAddress = c.token_address.startsWith('0x')
        ? c.token_address.slice(2)
        : c.token_address;
      const tokenBytes = new Uint8Array(32);
      for (let i = 0; i < 20; i++) {
        tokenBytes[12 + i] = parseInt(tokenAddress.slice(i * 2, i * 2 + 2), 16);
      }

      return {
        balance: c.balance,
        token_address: tokenBytes,
        value: c.value,
      };
    });

    result.push({
      chain_id: chainIdBytes,
      currencies,
      total_usd: chainData.total_usd,
      universe: chainData.universe as 0 | 1,
      errored: chainData.errored,
    });
  }

  return result;
};
```

**Step 2: Update getBalancesFromMiddleware to use adapter**

```typescript
export const getBalancesFromMiddleware = async (
  middlewareUrl: string,
  address: Hex,
  universe: 'evm' | 'tron' = 'evm',
): Promise<UnifiedBalanceResponseData[]> => {
  try {
    const response = await getMiddlewareClient(middlewareUrl).get<V2BalanceResponse>(
      `/balance/${universe}/${address}`,
    );
    logger.debug('getBalancesFromMiddleware', { response: response.data });
    return adaptV2BalanceToV1Format(response.data);
  } catch (error) {
    logger.error('Failed to fetch balances from middleware', error);
    throw Errors.internal('Failed to fetch balances from middleware');
  }
};
```

**Step 3: Commit**

```bash
git add src/sdk/ca-base/utils/middleware.utils.ts
git commit -m "feat: add V2 to V1 balance format adapter"
```

---

## Task 5: Update api.utils to Use Middleware for Balance

**Files:**
- Modify: `src/sdk/ca-base/utils/api.utils.ts:374-387`

**Step 1: Import middleware utilities**

At top of file, add:

```typescript
import {
  getBalancesFromMiddleware,
  createApprovalsViaMiddleware,
} from './middleware.utils';
```

**Step 2: Add middleware balance function**

```typescript
export const getEVMBalancesForAddressV2 = async (
  middlewareUrl: string,
  address: `0x${string}`,
) => {
  return getBalancesFromMiddleware(middlewareUrl, address, 'evm');
};
```

**Step 3: Commit**

```bash
git add src/sdk/ca-base/utils/api.utils.ts
git commit -m "feat: add V2 balance fetching via middleware"
```

---

## Task 6: Write E2E Devnet Test

**Files:**
- Create: `test/integration/v2-middleware-e2e.test.ts`
- Modify: `package.json` (add test script)

**Step 1: Write E2E test**

```typescript
import { execSync } from 'child_process';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  erc20Abi,
  maxUint256,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  getBalancesFromMiddleware,
  createApprovalsViaMiddleware,
  submitRffToMiddleware,
  getRffFromMiddleware,
  listRffsFromMiddleware,
} from '../../src/sdk/ca-base/utils/middleware.utils';
import type {
  V2ApprovalsByChain,
  V2MiddlewareRffPayload,
} from '../../src/commons';

const MIDDLEWARE_URL = 'http://localhost:3000';
const VAULT_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

const CHAINS = [
  { chainId: 42161, port: 8546, name: 'Arbitrum' },
  { chainId: 137, port: 8548, name: 'Polygon' },
];

const deployer = privateKeyToAccount(DEPLOYER_KEY);
const deployedTokens: Record<number, Address> = {};

function cast(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function toBytes32(addr: Hex): Hex {
  const hex = addr.replace(/^0x/, '');
  return `0x${hex.padStart(64, '0')}` as Hex;
}

async function deployMockToken(port: number): Promise<Address> {
  const result = JSON.parse(
    cast(`forge create src/tests/MockPermitToken.sol:MockPermitToken --private-key ${DEPLOYER_KEY} --rpc-url http://localhost:${port} --broadcast --json`)
  );
  return result.deployedTo as Address;
}

async function mintTokens(port: number, token: Address, to: Address, amount: bigint) {
  cast(`cast send ${token} "mint(address,uint256)" ${to} ${amount.toString()} --private-key ${DEPLOYER_KEY} --rpc-url http://localhost:${port} --gas-limit 1000000`);
}

async function getBalance(port: number, token: Address, address: Address): Promise<bigint> {
  const client = createPublicClient({ transport: http(`http://localhost:${port}`) });
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

async function signPermit(chainId: number, token: Address, nonce: bigint) {
  const domain = {
    name: 'USD Coin',
    version: '1',
    chainId: BigInt(chainId),
    verifyingContract: token,
  };
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  const message = {
    owner: deployer.address,
    spender: VAULT_ADDRESS,
    value: maxUint256,
    nonce,
    deadline: maxUint256,
  };
  const signature = await deployer.signTypedData({
    domain,
    types,
    primaryType: 'Permit',
    message,
  });
  return {
    v: parseInt(signature.slice(130, 132), 16),
    r: `0x${signature.slice(2, 66)}` as Hex,
    s: `0x${signature.slice(66, 130)}` as Hex,
  };
}

describe('V2 Middleware E2E', () => {
  beforeAll(async () => {
    for (const chain of CHAINS) {
      deployedTokens[chain.chainId] = await deployMockToken(chain.port);
      console.log(`Deployed token on ${chain.name}: ${deployedTokens[chain.chainId]}`);

      const mintAmount = parseUnits('1000', 6);
      await mintTokens(chain.port, deployedTokens[chain.chainId], deployer.address, mintAmount);
      console.log(`Minted ${formatUnits(mintAmount, 6)} tokens`);
    }
  }, 120000);

  test('fetch balances via middleware', async () => {
    const balances = await getBalancesFromMiddleware(MIDDLEWARE_URL, deployer.address, 'evm');

    expect(Array.isArray(balances)).toBe(true);
    expect(balances.length).toBeGreaterThan(0);

    const arbBalance = balances.find(b => {
      const chainIdNum = Number(BigInt('0x' + Array.from(b.chain_id).map(x => x.toString(16).padStart(2, '0')).join('')));
      return chainIdNum === 42161;
    });

    expect(arbBalance).toBeDefined();
    expect(arbBalance!.currencies.length).toBeGreaterThan(0);
  }, 30000);

  test('create approvals via middleware', async () => {
    const approvals: V2ApprovalsByChain = {};

    for (const chain of CHAINS) {
      approvals[chain.chainId] = [{
        address: deployer.address,
        ops: [{
          tokenAddress: deployedTokens[chain.chainId],
          variant: 1,
          value: null,
          signature: await signPermit(chain.chainId, deployedTokens[chain.chainId], 0n),
        }],
      }];
    }

    const results = await createApprovalsViaMiddleware(MIDDLEWARE_URL, approvals);

    expect(results.length).toBe(CHAINS.length);
    for (const result of results) {
      expect(result.errored).toBe(false);
      expect(result.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }
  }, 60000);

  test('submit RFF via middleware', async () => {
    const sourceChain = CHAINS[0];
    const destChain = CHAINS[1];
    const amount = parseUnits('100', 6).toString();

    const rffRequest: V2MiddlewareRffPayload['request'] = {
      sources: [{
        universe: 'EVM',
        chain_id: toBytes32(`0x${sourceChain.chainId.toString(16)}` as Hex),
        contract_address: toBytes32(deployedTokens[sourceChain.chainId]),
        value: amount,
        fee: '0',
      }],
      destination_universe: 'EVM',
      destination_chain_id: toBytes32(`0x${destChain.chainId.toString(16)}` as Hex),
      recipient_address: toBytes32(deployer.address),
      destinations: [{
        contract_address: toBytes32(deployedTokens[destChain.chainId]),
        value: amount,
      }],
      nonce: Date.now().toString(),
      expiry: (Math.floor(Date.now() / 1000) + 3600).toString(),
      parties: [{
        universe: 'EVM',
        address: toBytes32(deployer.address),
      }],
    };

    const signature = await deployer.signMessage({ message: 'test' }); // Placeholder
    const payload: V2MiddlewareRffPayload = { request: rffRequest, signature };

    const hash = await submitRffToMiddleware(MIDDLEWARE_URL, payload);
    expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const rff = await getRffFromMiddleware(MIDDLEWARE_URL, hash);
    expect(rff.request_hash).toBe(hash);
    expect(rff.status).toBe('created');
  }, 30000);
});
```

**Step 2: Add test script to package.json**

```json
"test:v2:middleware": "bun test/integration/v2-middleware-e2e.test.ts"
```

**Step 3: Run test to verify it compiles**

```bash
pnpm build
bun test/integration/v2-middleware-e2e.test.ts --dry-run
```

Expected: Test file loads without errors

**Step 4: Commit**

```bash
git add test/integration/v2-middleware-e2e.test.ts package.json
git commit -m "test: add V2 middleware E2E test"
```

---

## Task 7: Update Bridge Handler for V2

**Files:**
- Modify: `src/sdk/ca-base/requestHandlers/bridge.ts`

**Step 1: Import middleware utilities**

```typescript
import {
  submitRffToMiddleware,
  getRffFromMiddleware,
  createApprovalsViaMiddleware,
} from '../utils/middleware.utils';
import type { V2MiddlewareRffPayload, V2ApprovalsByChain } from '../../../commons';
```

**Step 2: Add processRFFv2 method using middleware**

After existing `processRFFv2` method (around line 650), replace with:

```typescript
private async processRFFv2Middleware = async (
  intent: Intent,
  msd: (step: BridgeStepType) => void,
) => {
  const { request, signature } = await createV2RequestFromIntent(
    intent,
    {
      chainList: this.options.chainList,
      evm: { address: this.options.evm.address, client: this.options.evm.client },
      tron: this.options.tron,
    },
    intent.destination.universe,
  );

  msd(BRIDGE_STEPS.INTENT_SUBMITTING_TO_STATEKEEPER);

  const payload: V2MiddlewareRffPayload = { request, signature };
  const requestHash = await submitRffToMiddleware(
    this.options.networkConfig.MIDDLEWARE_URL,
    payload,
  );

  logger.debug('processRFFv2Middleware', { requestHash });
  return requestHash;
};
```

**Step 3: Commit**

```bash
git add src/sdk/ca-base/requestHandlers/bridge.ts
git commit -m "feat: add V2 RFF submission via middleware"
```

---

## Task 8: Add Configuration Flag for V2

**Files:**
- Modify: `src/commons/types/index.ts` (NetworkConfig)
- Modify: `src/sdk/ca-base/config.ts`

**Step 1: Add useV2Middleware flag to NetworkConfig**

```typescript
export type NetworkConfig = {
  COSMOS_URL: string;
  EXPLORER_URL: string;
  GRPC_URL: string;
  NETWORK_HINT: Environment;
  VSC_DOMAIN: string;
  STATEKEEPER_URL: string;
  MIDDLEWARE_URL: string;
  useV2Middleware?: boolean;  // NEW: opt-in flag
};
```

**Step 2: Set flag in configs**

```typescript
export const JADE: NetworkConfig = {
  // ... existing fields
  MIDDLEWARE_URL: 'http://localhost:3000',
  useV2Middleware: false,  // Default to V1
};
```

**Step 3: Commit**

```bash
git add src/commons/types/index.ts src/sdk/ca-base/config.ts
git commit -m "feat: add useV2Middleware configuration flag"
```

---

## Task 9: Update executeV2 to Use Middleware When Enabled

**Files:**
- Modify: `src/sdk/ca-base/requestHandlers/bridge.ts:230-280`

**Step 1: Add conditional logic in executeV2**

Find the `executeV2` method and update:

```typescript
async executeV2(intent: Intent, msd: (step: BridgeStepType) => void = () => {}) {
  if (this.options.networkConfig.useV2Middleware) {
    return this.executeV2ViaMiddleware(intent, msd);
  }
  // Existing V2 logic (statekeeper direct)
  return this.executeV2Direct(intent, msd);
}

private async executeV2ViaMiddleware(intent: Intent, msd: (step: BridgeStepType) => void) {
  msd(BRIDGE_STEPS.CREATING_SPONSORED_APPROVAL);
  await this.createApprovalsViaMiddleware(intent);

  msd(BRIDGE_STEPS.INTENT_SUBMITTING);
  const requestHash = await this.processRFFv2Middleware(intent, msd);

  msd(BRIDGE_STEPS.INTENT_SUBMITTED);
  await this.waitForFillV2(requestHash, msd);

  return { requestHash };
}

private async executeV2Direct(intent: Intent, msd: (step: BridgeStepType) => void) {
  // Existing processRFFv2 logic
  msd(BRIDGE_STEPS.INTENT_SUBMITTING);
  const requestHash = await this.processRFFv2(intent, msd);

  msd(BRIDGE_STEPS.INTENT_SUBMITTED);
  await this.waitForFillV2(requestHash, msd);

  return { requestHash };
}
```

**Step 2: Commit**

```bash
git add src/sdk/ca-base/requestHandlers/bridge.ts
git commit -m "feat: add middleware path in executeV2"
```

---

## Task 10: Add Middleware Approval Creation

**Files:**
- Modify: `src/sdk/ca-base/requestHandlers/bridge.ts`

**Step 1: Add approval adapter function**

```typescript
private convertToMiddlewareApprovals(sponsoredApprovals: SponsoredApprovalDataArray): V2ApprovalsByChain {
  const result: V2ApprovalsByChain = {};

  for (const approval of sponsoredApprovals) {
    const chainId = Number(BigInt('0x' + Array.from(approval.chain_id).map(b => b.toString(16).padStart(2, '0')).join('')));
    const address = `0x${Array.from(approval.address).slice(-20).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex;

    if (!result[chainId]) {
      result[chainId] = [];
    }

    const ops = approval.operations.map(op => ({
      tokenAddress: `0x${Array.from(op.token_address).slice(-20).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex,
      variant: op.variant as 1 | 2,
      value: op.value ? `0x${Array.from(op.value).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex : null,
      signature: {
        v: op.sig_v,
        r: `0x${Array.from(op.sig_r).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex,
        s: `0x${Array.from(op.sig_s).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex,
      },
    }));

    result[chainId].push({ address, ops });
  }

  return result;
}
```

**Step 2: Add middleware approval method**

```typescript
private async createApprovalsViaMiddleware(intent: Intent) {
  const sponsoredApprovals = await this.buildSponsoredApprovals(intent);
  const middlewareApprovals = this.convertToMiddlewareApprovals(sponsoredApprovals);

  const results = await createApprovalsViaMiddleware(
    this.options.networkConfig.MIDDLEWARE_URL,
    middlewareApprovals,
  );

  for (const result of results) {
    if (result.errored) {
      throw Errors.internal(`Approval failed on chain ${result.chainId}: ${result.message}`);
    }
  }

  return results.map(r => ({ chainId: r.chainId, hash: r.txHash! }));
}
```

**Step 3: Commit**

```bash
git add src/sdk/ca-base/requestHandlers/bridge.ts
git commit -m "feat: add middleware approval creation"
```

---

## Task 11: Run E2E Test

**Files:**
- None (test execution)

**Step 1: Ensure services are running**

```bash
# Terminal 1: Anvil chains should be running on 8545-8548
# Terminal 2: Statekeeper should be running on 9080
# Terminal 3: Middleware should be running on 3000
```

**Step 2: Build SDK**

```bash
pnpm build
```

**Step 3: Run E2E test**

```bash
pnpm test:v2:middleware
```

Expected: All tests pass

**Step 4: If tests fail, debug and fix**

Check logs for:
- Middleware connection errors
- Approval signature issues
- RFF submission failures

**Step 5: Once passing, document in commit**

```bash
git add -A
git commit -m "test: verify V2 middleware E2E flow"
```

---

## Task 12: Update Documentation

**Files:**
- Modify: `COMPLETE_FLOW_DIAGRAM.md` (add middleware section)
- Modify: `README.md` (add V2 configuration)

**Step 1: Add middleware section to flow diagram**

```markdown
## V2 Middleware Protocol (localhost:3000)

### Balance Fetching
1. SDK → `GET /api/v1/balance/evm/:address` → Middleware
2. Middleware → Fetches from all chain RPCs → Returns JSON
3. Response: `{ "42161": { currencies: [...], total_usd, universe, errored } }`

### Approval Creation
1. SDK → `WSS /api/v1/create-sponsored-approvals` → Middleware
2. Middleware → Submits permit txs to chains → Returns streamed responses
3. Response per chain: `{ chainId, address, errored, txHash }`

### RFF Submission
1. SDK → `POST /api/v1/rff` → Middleware → Statekeeper
2. Statekeeper validates & stores → Returns request_hash
3. Response: `{ request_hash: "0x..." }`

### RFF Status
1. SDK → `GET /api/v1/rff/:hash` → Middleware → Statekeeper
2. Response: `{ request, request_hash, signature, status, solver }`
```

**Step 2: Update README**

```markdown
## V2 Protocol Configuration

Enable V2 middleware:

```typescript
import { JADE } from '@avail-project/nexus-core';

const config = {
  ...JADE,
  useV2Middleware: true,
  MIDDLEWARE_URL: 'http://localhost:3000',
};
```

V2 uses:
- REST API for balance & RFF operations
- WebSocket (JSON) for approvals
- Direct statekeeper integration via middleware
```

**Step 3: Commit**

```bash
git add COMPLETE_FLOW_DIAGRAM.md README.md
git commit -m "docs: add V2 middleware documentation"
```

---

## Task 13: Add Migration Guide

**Files:**
- Create: `docs/V1_TO_V2_MIGRATION.md`

**Step 1: Write migration guide**

```markdown
# V1 → V2 Migration Guide

## Overview

V2 replaces msgpack WebSocket APIs with REST/JSON APIs via middleware.

## Breaking Changes

### 1. Configuration

**V1:**
```typescript
{ VSC_DOMAIN: 'vsc-mainnet.availproject.org' }
```

**V2:**
```typescript
{
  MIDDLEWARE_URL: 'http://localhost:3000',
  useV2Middleware: true,
}
```

### 2. Balance Response Format

**V1:** Uint8Array fields, msgpack
**V2:** JSON with string chain IDs as keys

**Migration:** SDK handles conversion automatically

### 3. Approval Format

**V1:** msgpack with Uint8Array
**V2:** JSON with hex strings

**Migration:** SDK handles conversion automatically

### 4. RFF Creation

**V1:** Cosmos submit + VSC WebSocket
**V2:** Single POST to middleware

**Migration:** Use `executeV2()` with `useV2Middleware: true`

## Migration Steps

1. Update config to add `MIDDLEWARE_URL` and `useV2Middleware: true`
2. Ensure middleware is running on localhost:3000
3. No code changes needed - SDK handles protocol differences
4. Test with local devnet first

## Rollback

Set `useV2Middleware: false` to use V1 protocol.
```

**Step 2: Commit**

```bash
git add docs/V1_TO_V2_MIGRATION.md
git commit -m "docs: add V1 to V2 migration guide"
```

---

## Remaining V1 Dependencies

After completing all tasks, these V1 VSC dependencies will still exist:

1. **Cosmos Chain (GRPC)**: Used for:
   - Fetching historical intent data (`fetchMyIntents`)
   - Cosmos fee grant operations (`cosmosFeeGrant`)
   - Legacy V1 flow

2. **VSC WebSocket** (msgpack): Used for:
   - V1 balance fetching (when `useV2Middleware: false`)
   - V1 approval creation
   - V1 RFF token collection

3. **Files still using V1**:
   - `src/sdk/ca-base/utils/api.utils.ts` (V1 functions remain for backward compatibility)
   - `src/sdk/ca-base/requestHandlers/bridge.ts` (V1 `execute()` method unchanged)
   - `src/sdk/ca-base/swap/` (swap operations still use V1)

**Recommendation:** Keep V1 code paths for backward compatibility. Add deprecation warnings in logs when V1 is used.

---

## Testing Checklist

Before marking complete:

- [ ] Middleware running on localhost:3000
- [ ] Statekeeper running on localhost:9080
- [ ] Anvil chains running on 8545-8548
- [ ] `pnpm build` succeeds
- [ ] `pnpm test:v2:middleware` passes
- [ ] Balance fetching works
- [ ] Approval creation works
- [ ] RFF submission works
- [ ] RFF retrieval works
- [ ] Existing V1 tests still pass
- [ ] Documentation updated

---

## Execution Options

Plan saved to `docs/plans/2026-01-23-v1-to-v2-middleware-migration.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
