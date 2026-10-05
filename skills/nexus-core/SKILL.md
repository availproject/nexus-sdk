---
name: nexus-core
description: Integrate or migrate applications using @avail-project/nexus-core. Use for client setup, asset pickers, balances, cross-chain swaps and same-asset bridging, wallet-free exact-input quote previews, quote review, progress, EVM contract execution, composite funding, history, and error recovery.
---

# Nexus Core integration

Build integrations against the public package exports. This file describes the current API;
examples share the setup below. Use quoted routes and fees rather than computing them in the app.
Bring the application's wallet connector and UI; the SDK is headless.

## Setup and lifecycle

Install `@avail-project/nexus-core`. Import SDK types from the package root and utility functions
from `@avail-project/nexus-core/utils`; `client.utils` also exposes the utilities.

```ts
import {
  createNexusClient,
  ERROR_CODES,
  NexusError,
  UserActionError,
  getIntentQuoteFailure,
  type EthereumProvider,
  type ExecuteParams,
  type IntentHookData,
  type IntentEvent,
  type SwapOperationOptions,
  type TokenRef,
} from '@avail-project/nexus-core';
import { formatUnits, parseUnits } from '@avail-project/nexus-core/utils';

const client = createNexusClient({ clientId: 'your-app-name', network: 'mainnet' });
await client.initialize();

const destination: TokenRef = {
  chainId: 8453,
  tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};
const source: TokenRef = {
  chainId: 1,
  tokenAddress: '0xA0b86991c6218b36c1d19d4a2e9eb0cE3606eB48',
};
const destinationToken = await client.getToken(destination);
const sourceToken = await client.getToken(source);
const destinationAmountRaw = parseUnits('10', destinationToken.decimals);
const sourceAmountRaw = parseUnits('5', sourceToken.decimals);

// Connect before balances or execution; omit this step for catalog/rate previews.
declare const provider: EthereumProvider; // From the application's EIP-1193 wallet connector.
await client.setEVMProvider(provider);
```

`clientId` must be a non-empty, stable application identifier. Config also accepts `network`,
`debug`, `analytics`, and `devTiming`. The default network is `mainnet`.
`mainnet` and `canary` use mainnet chains; `testnet` permits standalone execution but rejects
intent operations and async intent catalog methods. A custom network object uses
`{ MIDDLEWARE_HTTP_URL, INTENT_EXPLORER_URL, NETWORK_HINT }`.

Initialize once per client. Recreate and destroy the old client on account/provider replacement;
the SDK captures the wallet account. Do not recreate it for chain switches caused by SDK execution.
Use `client.hasEvmProvider` for connection state and `client.destroy()` for cleanup.
Product analytics can be disabled with `analytics: { enabled: false }`; diagnostic logging is
independent. Do not imply that this setting disables all diagnostics.

## Discover and select assets

All catalog methods below require initialization; on mainnet/canary they work without a wallet.

| Method | Result |
| --- | --- |
| `getSupportedChains()` | Synchronous `IntentChainMetadata[]`, without token lists |
| `isSupportedChain(chainId)` | Whether the chain is in the supported catalog |
| `getTokens(query?)` | `{ tokens, offset, limit, total }` |
| `getTokensByChain(chainId, query?)` | Same token page; omit query.chainId |
| `getToken({ chainId, tokenAddress })` | Exact `IntentToken` |
| `getAvailableSourceTokens(destination, selectedSources?, query?)` | `{ groups, offset, limit, total }` |
| `getAvailableDestinationTokens(sources, query?)` | `{ chains, offset, limit, total }` |
| `confirmRouteExists(sources, destination)` | Common-provider compatibility, not guaranteed execution |
| `getSupportedChainsForRoute(constraints)` | `IntentChainMetadata[]` matching route constraints |

Filter chain lists by `capabilities.intent` or `capabilities.execute` for the operation.
`client.chainList` is available for execution metadata, but its known tokens are not a full catalog.

`IntentTokenQuery` accepts `chainId?`, `providers?`, `includeUnverified?`, `name?`, `symbol?`,
`contract?`, `offset?`, and `limit?`. Name/symbol/contract match case-insensitive substrings;
filters combine with AND. Defaults are offset 0, limit 50, verified-only; limit is 1–1000.
Set `includeUnverified: true` to include both. Exact lookup resolves explicit unverified assets too.

Returned tokens have `chainId`, `address`, `symbol`, `name`, `decimals`, `isNative`, `verified`,
and provider metadata. Convert `address` to `tokenAddress` in `TokenRef`.
Never use symbol alone as identity or infer decimals from it. Native selections use catalog addresses.

Advance pages by `offset + limit` until it reaches `total`, including empty compatibility pages:
pagination counts API candidates before directional filtering. Reset offset when filters/selections
change, debounce searches, ignore stale responses, and retain selections outside the current page.

Source pages contain `groups[].provider` and `groups[].chains[].tokens`; destination pages contain
`chains[].tokens`. Deduplicate displayed tokens by chain ID and address. Provider groups do not pin
the provider of a later quote.

For exact input, pass selected sources when requesting another source; all sources and destination
must share a provider. For exact output, sources are alternatives: call
`getAvailableSourceTokens(destination, [], query)` rather than intersecting the alternatives.
Do not reject exact-output alternatives merely because `confirmRouteExists` returns false for
the whole set. That helper returns false for empty sources, unknown identities, or incompatibility;
network failures reject. Other lookup failures also reject separately from empty pages.

Route constraints accept `sources?`, `destinations?`, `providers?`, `valueUsd?`.
Each leg has `chainId?`, `tokenAddress?`, `amountRaw?` and needs at least one identity field;
raw amounts require both. Each side's legs must use the same fields. Choose at most one sizing
mode: source amounts, destination amounts, or a non-negative finite USD value. Raw amounts must
be non-negative. Later token queries do not inherit these constraints.

## Balances and amounts

`await client.getBalances()` requires a wallet and returns `IntentBalance[]`.
Each entry has chain/token identity, `balanceRaw`, `decimals`, `isNative`, `verified`, `usable`,
provider metadata, optional logo, and nullable `valueUsd` / `priceSource`.
Holdings include verified and unverified assets; there is no balance verification filter.
Respect `usable` and retain gas for subsequent native-token actions.

Convert user input with `parseUnits(inputString, token.decimals)` and render with
`formatUnits(raw, token.decimals)`. Preserve raw amounts as `bigint`, never `number`.
Quote USD amounts are decimal strings; balance USD values are nullable numbers.
`getBalancesForSwap()` is a deprecated identical alias; use `getBalances()` in new integrations.

## Choose and call swaps

Use either swap method for same-asset bridging, selecting each chain's own contract address.
There is no recipient override. Exact-output and composite calls need a wallet.

```ts
const exactOut = {
  toChainId: destination.chainId,
  toTokenAddress: destination.tokenAddress,
  toAmountRaw: destinationAmountRaw,
  sources: [source],
};
const exactIn = {
  sources: [{ ...source, amountRaw: sourceAmountRaw }],
  toChainId: destination.chainId,
  toTokenAddress: destination.tokenAddress,
};
```

Call `client.swapWithExactOut(exactOut, options?)` or `client.swapWithExactIn(exactIn, options?)`.

Exact output requires a positive destination amount and permits omitted/empty sources for automatic
funding. Explicit sources are `{ chainId, tokenAddress? }[]`; chain-only entries restrict chains.
Optional `toNativeAmountRaw` requests non-negative destination native funds for gas.
Incompatible explicit selections never silently become unrestricted wallet discovery.

Exact input requires at least one source, each with chain ID, token address, and positive
`amountRaw`. All sources and destination must share one provider. Do not invent amounts or max helpers.

## Quote review, refresh, and disconnected previews

```ts
declare function showReview(hook: IntentHookData): void;
const options: SwapOperationOptions = {
  hooks: { onIntent: showReview },
  onEvent(event: IntentEvent) {
    if (event.type === 'quote') console.log(event.quote.plan.steps);
    if (event.type === 'step') console.log(event.step.id, event.state, event.errorDetails);
    if (event.type === 'status') console.log(event.intentId, event.status, event.legs);
  },
  slippageBps: 50,
  fillTimeoutMinutes: 2,
  pollingIntervalMs: 2000,
};
```

These are the option defaults. Slippage accepts integer basis points from 0 to 10000 or `'auto'`.
Wire UI confirm/cancel actions to `hook.allow()` / `hook.deny()`; returning from a hook does not
settle review. Omitting `onIntent` auto-allows. Hooks belong under `options.hooks`.

The hook contains `quote`, `execution`, `allow`, `deny`, `refresh`, and optional `attemptId`.
Display quote inputs and total source requirements, output/minimum output, fees, provider,
allowances, plan, source verdicts, and expiry (`expiresAt` is Unix seconds).
Use the quote's fees and USD values directly. The SDK handles minimum ERC-20 approvals,
sponsored approval signatures, intent signing, source transactions, submission, and fulfillment.

`await hook.refresh(sources?)` returns a complete replacement quote. Render the return value,
then read `hook.execution` again. Await refresh before allowing; don't merge old and new fields.
Exact-input replacements require token addresses and amounts on every source.
After acceptance the executable quote is fixed.

`execution` is `{ possible: true }` or
`{ possible: false, cause: 'not-connected' | 'insufficient-balance' }`.
`not-connected` takes priority. `quote.isExecutable` only reflects the source-balance check;
`executionWarnings[].shortfalls` gives raw required/actual amounts.

For wallet-free rate previews, initialize and call `swapWithExactIn` before `setEVMProvider`.
Keep the hook pending while showing output/fees. Offer connect/cancel instead of execution when
`execution.cause` is `not-connected`; after connecting, settle the old review and start a new call
with a fresh quote. Connection during review cannot make the old operation executable.
`allow()` or auto-approval rejects it with `ERROR_CODES.WALLET_NOT_CONNECTED`; `deny()` rejects
as a user denial. A disconnected preview never resolves with a preview result.
Missing unsponsored approval gas can prevent even a preview quote.
For connected insufficient-balance quotes, show warnings and fund/refresh before approval.

## Events and results

Intent events are `quote`, `step`, and `status`. Step states are `started | completed | failed`.
Step types are `erc20_approval`, `source_approval_signature`, `intent_signature`,
`native_transaction`, `intent_submission`, and `intent_fulfillment`.
Step events also expose `committed` and optional structured `errorDetails`; the `error` string is
deprecated. Statuses are `created | deposited | fulfilled | expired`; status events include per-source
`legs` with status, transaction links, and provider errors. Event callback failures are isolated.

Swaps resolve only after fulfillment as `IntentResult` (`SwapResult` is an alias):
`{ intentId, intentExplorerUrl, quote, status, approvals, nativeTransactions, attemptId? }`.
Use `quote.input`, `quote.output`, and `status.legs` for source/destination views.
Keep `attemptId` with `intentId` for support. Rejecting does not mean no transaction was submitted.

## Standalone execute and simulation

```ts
declare const contract: ExecuteParams['to'];
declare const calldata: ExecuteParams['data'];
const executeParams: ExecuteParams = {
  toChainId: destination.chainId,
  to: contract,
  data: calldata,
  value: 0n,
  tokenApproval: {
    toTokenAddress: destination.tokenAddress,
    amount: destinationAmountRaw,
    spender: contract,
  },
};
const simulation = await client.simulateExecute(executeParams);
const executed = await client.execute(executeParams);
console.log(simulation.estimatedTotalCost, executed.execute.txExplorerUrl);
```

Both require initialization and a wallet. Omit `tokenApproval` when unnecessary; native transfers
use `value`. Approvals identify ERC-20 contracts by address, with raw `amount`.
`ExecuteParams` also accepts `gas?` and `gasPrice?: 'low' | 'medium' | 'high'`.
Simulation estimates required approval and call gas; it can fail when the unfunded call cannot run.
It returns `{ feeParams, estimatedGasUnits, estimatedTotalCost }` with raw bigint values.

Execute returns `{ execute, approval?, chainId, confirmations?, gasUsed?, effectiveGasPrice? }`.
Transactions expose `txHash`, `txExplorerUrl`, and optional `receipt`.
By default execution waits for a receipt. Supported receipt controls are `waitForReceipt`
(default true), `receiptTimeout` (milliseconds, default 300000), and `requiredConfirmations`
(default 1). A broadcast-only result does not establish transaction success.
Do not promise standalone execute progress via `IntentEvent`; those events describe intent funding.

## Fund and execute a destination call

```ts
const composed = await client.swapAndExecute(
  {
    toChainId: destination.chainId,
    toTokenAddress: destination.tokenAddress,
    toAmountRaw: destinationAmountRaw,
    sources: [source],
    execute: {
      to: contract,
      data: calldata,
      gas: 350_000n,
      tokenApproval: executeParams.tokenApproval,
    },
  },
  {
    hooks: {
      onIntent({ intent, allow }) {
        console.log(intent.executeRequirement, intent.available, intent.shortfall);
        allow(); // Wire this to user confirmation in a real app.
      },
    },
    beforeExecute: async () => ({ data: calldata }),
  },
);
if (!composed.swapSkipped) console.log(composed.swapResult.intentExplorerUrl);
console.log(composed.execute.txExplorerUrl);
```

Supply positive `toAmountRaw` and a positive, contract-appropriate raw `execute.gas` estimate.
Execute fields are `to`, `data?`, `value?`, `gas`, `gasPrice?`, and `tokenApproval?`.
The SDK funds token/native shortfalls including later execution gas, waits for funding fulfillment,
then executes. Sources restrict eligible balances as well as funding sources.

Composite options share slippage, timeouts, polling, and intent events, but the hook receives
`{ intent, allow, deny, refresh, attemptId? }`. It also runs when funding is already sufficient.
Show `intent.executeRequirement`, `available`, `shortfall`, and `swapRequired`;
`intent.quote` exists only when `swapRequired` is true. Funding amounts expose raw and readable
values plus optional USD values. Do not treat this hook as ordinary `IntentHookData`.

`refresh(sources?)` returns a replacement composite intent and refreshes fee estimates and funding
quotes. It reuses initial balances; a new operation is needed to reread balances. Omitted sources
retain the last selection; `[]` clears it. A failed refresh retains the prior preview.
Await refresh before allowing. Top-level `beforeExecute` runs after funding and may return
`{ data?, value?, gas? }`; overrides do not trigger another funding calculation.

The result has `execute`, optional `approval`, and a `swapSkipped` discriminant.
Read `swapResult` only when `swapSkipped === false`. Intent fulfillment covers the funding leg;
keep the UI pending until the composite promise resolves after contract execution.

## History, utilities, and recovery

`await client.listIntents({ page: 1, status: 'fulfilled' })` returns `{ intents, total }`, newest
first, for the connected wallet. Both params are optional; statuses use the intent lifecycle union.
Records expose `id`, `status`, optional `provider`, `explorerUrl`, and timestamps.

Utilities include `parseUnits`, `formatUnits`, `formatTokenBalance`, `formatTokenBalanceParts`,
`isValidAddress`, `truncateAddress`, `getCoinbaseRates`, and `getSupportedChains`.
Standalone `getSupportedChains(network, { clientId })` fetches a chain summary;
`client.utils.getSupportedChains(network)` supplies the client ID. For capability metadata, use
`client.getSupportedChains()`. The package root also exports `getFallbackTokenLogoDataUri`.

Handle `NexusError` subclasses first, then stable `ERROR_CODES`. Errors carry `category`,
`code`, `context`, and optional `details`. Use `UserActionError` for a declined action.
`getIntentQuoteFailure(error)` returns structured quote diagnostics or null; preserve
`subcode`, `sourceVerdicts`, `providerReasons`, `retryable`, and `errorId` for UI/support.
Never parse messages for control flow.

```ts
async function submitSwap() {
  try {
    return await client.swapWithExactOut(exactOut, options);
  } catch (error) {
    if (error instanceof UserActionError) return;
    if (error instanceof NexusError) {
      if (error.code === ERROR_CODES.WALLET_NOT_CONNECTED) console.log('Connect wallet');
      console.error(error.code, error.context, getIntentQuoteFailure(error));
    }
    throw error;
  }
}
```

After timeout/network failure following commitment, inspect history, explorer, and known hashes
before retrying: delivery may still complete. Failed approvals may expose `details.approvals`
with `confirmed | reverted | unconfirmed` states; unconfirmed transactions may still confirm.
Start a fresh swap/quote to reflect already-confirmed allowances. A composite execution failure
does not undo a fulfilled funding intent.

## Migration boundaries

Do not generate calls to removed bridge/transfer methods, their simulations, standalone swap
simulations, max helpers, recipient overrides, `onAllowance`, Safe clients, ephemeral-key options,
or local routing APIs. Replace bridge calls with address-based swaps and bridge-and-execute with
`swapAndExecute`. Replace old event unions and `sourceTxs` / `sourceSwaps` / `destinationSwap`
result reads with `IntentEvent` and `IntentResult`. Put all intent hooks under `options.hooks`.
