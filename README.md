# `@avail-project/nexus-core`

Headless TypeScript SDK for cross-chain swaps, same-asset bridging, wallet balances, and EVM
contract execution. Bring your own wallet connection and user interface.

## Install and connect

```bash
npm install @avail-project/nexus-core
```

```ts
import { createNexusClient, type EthereumProvider } from '@avail-project/nexus-core';
import { formatUnits, parseUnits } from '@avail-project/nexus-core/utils';

const client = createNexusClient({ clientId: 'your-app-name', network: 'mainnet' });
await client.initialize();

// Use the EIP-1193 provider supplied by your wallet connector.
declare const provider: EthereumProvider;
await client.setEVMProvider(provider);
```

`clientId` is a required, non-empty, stable application identifier. Catalog queries and exact-input
quote previews need initialization but no wallet. Execution and wallet balances need a connected
provider. Recreate the client after account/provider changes and call `client.destroy()` on cleanup.

`mainnet` and `canary` use mainnet chains. `testnet` supports standalone execution only; intent
operations and async intent catalog helpers reject with `ENVIRONMENT_NOT_SUPPORTED`.

## Choose an operation

| Need | Method |
| --- | --- |
| Receive a specified destination amount | `swapWithExactOut` |
| Spend specified source amounts | `swapWithExactIn` |
| Bridge the same asset across chains | Either swap method, with that asset's address on each chain |
| Fund a destination contract call, then execute it | `swapAndExecute` |
| Execute using funds already on the destination | `execute` |
| Estimate a standalone contract call | `simulateExecute` |

Amounts are raw `bigint` values. Resolve tokens by chain ID and contract address, then use their own
decimals with `parseUnits` / `formatUnits`. Native-token addresses come from catalog metadata.
Routes, providers, and fees are determined by the quote.

## Discover assets and balances

```ts
const chains = client.getSupportedChains();
const swapChains = chains.filter((chain) => chain.capabilities.intent);
const executeChains = chains.filter((chain) => chain.capabilities.execute);

const page = await client.getTokensByChain(8453, { symbol: 'USDC', limit: 25 });
const baseUsdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const destination = { chainId: 8453, tokenAddress: baseUsdc } as const;
const token = await client.getToken(destination);
const amountRaw = parseUnits('10', token.decimals);

const balances = await client.getBalances();
for (const balance of balances) {
  console.log(balance.symbol, formatUnits(balance.usableBalanceRaw, balance.decimals), balance.usable);
}
```

Balances expose `actualBalanceRaw` (full wallet balance) and `usableBalanceRaw` (available for
routing after gas reserves) as `bigint`. `balanceRaw` is a deprecated alias of `usableBalanceRaw`.
`valueUsd` values the usable balance and is `null` when no price is available.

| Catalog method | Returns |
| --- | --- |
| `getSupportedChains()` | Cached chain metadata, without token lists |
| `getTokens(query?)` | Token page across chains |
| `getTokensByChain(chainId, query?)` | Token page on one chain |
| `getToken({ chainId, tokenAddress })` | Exact token metadata |
| `getAvailableSourceTokens(destination, selectedSources?, query?)` | Page of provider groups containing chains and tokens |
| `getAvailableDestinationTokens(sources, query?)` | Page of chains containing destination tokens |
| `confirmRouteExists(sources, destination)` | Catalog compatibility as a boolean |
| `getSupportedChainsForRoute(constraints)` | Chain metadata matching route constraints |

Token queries accept `chainId`, `providers`, `name`, `symbol`, `contract`, `includeUnverified`,
`offset`, and `limit`. Filters combine with AND. Pages default to offset 0 and limit 50; the maximum
limit is 1000. Token pages default to verified assets; opt in with `includeUnverified: true`.
Exact lookup can resolve unverified tokens. Balances include both; respect `verified` and `usable`.

Advance pagination by `page.offset + page.limit` while that is less than `page.total`. Compatibility
pages count candidates before filtering, so an empty page does not mean there are no later matches.
Reset the offset when filters or selections change. Keep selections outside the displayed page;
returned tokens use `address`, while selections use `tokenAddress`. Deduplicate provider groups
by chain ID plus address.

For exact-input pickers, pass existing sources to `getAvailableSourceTokens` so all selections
share one provider. Exact-output sources are alternatives: use
`getAvailableSourceTokens(destination, [], query)`. `confirmRouteExists` requires a provider shared
by all sources and does not guarantee a quote. Token pickers ignore selected tokens absent from the
catalog; an unknown destination returns an empty source page. Direct token lookups and backend
failures still reject.

Route constraints accept `sources`, `destinations`, `providers`, and `valueUsd`. Legs accept
`chainId?`, `tokenAddress?`, and `amountRaw?`; amounts require both identity fields. Use the same
fields on each leg of one side, and at most one sizing mode: source amounts, destination amounts,
or USD value. Amounts must be non-negative. Token queries do not inherit route constraints.

## Swap

Exact output specifies what to receive. Omit `sources` (or pass `[]`) for automatic wallet funding;
explicit sources restrict eligible chains and tokens. `toNativeAmountRaw` optionally requests
destination native funds for gas. Unsupported source candidates are skipped; if none remain, the
swap rejects without broadening the source selection.

```ts
const result = await client.swapWithExactOut({
  toChainId: destination.chainId,
  toTokenAddress: destination.tokenAddress,
  toAmountRaw: amountRaw,
  sources: [{ chainId: 1, tokenAddress: '0xA0b86991c6218b36c1d19d4a2e9eb0cE3606eB48' }],
});
console.log(result.intentId, result.intentExplorerUrl);
```

Exact input specifies every source's positive raw amount. All sources and the destination must
share one provider.

```ts
const source = {
  chainId: 1,
  tokenAddress: '0xA0b86991c6218b36c1d19d4a2e9eb0cE3606eB48',
} as const;
const sourceToken = await client.getToken(source);
await client.swapWithExactIn({
  sources: [{ ...source, amountRaw: parseUnits('5', sourceToken.decimals) }],
  toChainId: destination.chainId,
  toTokenAddress: destination.tokenAddress,
});
```

## Review quotes and preview rates

Pass `options.hooks.onIntent` to display a confirmation UI. The operation waits for `allow()` or
`deny()`; returning from the callback alone does not accept it. Without a hook, quotes are accepted
automatically. ERC-20 approvals use the minimum required amount; wallets may also prompt for
approval signatures and source transactions.

```ts
import type { IntentHookData, SwapOperationOptions } from '@avail-project/nexus-core';

declare function showReview(hook: IntentHookData): void;
const options: SwapOperationOptions = {
  hooks: { onIntent: showReview },
  slippageBps: 50,
  fillTimeoutMinutes: 2,
  pollingIntervalMs: 2000,
};
```

Pass `options` as the second argument to either swap method. These are the default option values.
Slippage accepts an integer from 0 to 10000 or `'auto'`. The review UI uses `hook.quote`,
`hook.execution`, `hook.allow()`, `hook.deny()`, and `await hook.refresh(sources?)`.
Refresh returns a complete replacement quote; render that return value and read `hook.execution`
again. Await refresh before allowing. Exact-input replacement sources must still carry token
addresses and raw amounts. The quote is fixed after acceptance.

Quotes expose `input`, `output`, `output.minAmountRaw`, `fees`, `allowances`, `plan`,
`sourceVerdicts`, and `expiresAt` (Unix seconds). Amounts ending in `Raw` are `bigint`;
USD quote amounts are decimal strings. `quote.isExecutable` is a source-balance check;
`quote.executionWarnings` describes any shortfalls.

`swapWithExactIn` can preview rates before wallet connection. Its hook exposes:

```ts
type QuoteExecution =
  | { possible: true }
  | { possible: false; cause: 'not-connected' | 'insufficient-balance' };
```

A preview remains disconnected throughout that operation. After connecting, start a new swap call
and review its fresh quote. `allow()` on a disconnected preview rejects with `WALLET_NOT_CONNECTED`;
`deny()` rejects as a user denial. There is no successful preview result. Without a hook, the quote
event is emitted and the call rejects. Preview quotes can also fail if source approval gas is missing.
Connected quotes with insufficient balances cannot execute; fund the wallet and refresh.
Exact-output and composite operations require a wallet.

## Progress and results

`options.onEvent` receives `IntentEvent`:

- `quote`: the current quote and plan.
- `step`: `step`, `state` (`started`, `completed`, or `failed`), `committed`, and optional
  `errorDetails`.
- `status`: `intentId`, `status` (`created`, `deposited`, `fulfilled`, or `expired`),
  `substatus`, and per-source `legs` with transaction links and errors.

```ts
import type { IntentEvent } from '@avail-project/nexus-core';

const onEvent = (event: IntentEvent): void => {
  switch (event.type) {
    case 'quote':
      console.log('Quote updated', event.quote.output, event.quote.fees, event.quote.plan.steps);
      break;
    case 'step':
      console.log('Step progress', event.step.type, event.state);
      if (event.state === 'failed') {
        console.error(event.errorDetails?.message, event.errorDetails?.code);
        // A committed attempt may still settle; check its status before retrying.
        console.log('Intent committed', event.committed);
      }
      break;
    case 'status':
      console.log('Intent status', event.intentId, event.status, event.substatus);
      for (const leg of event.legs) {
        console.log('Source progress', leg.sourceIndex, leg.status, leg.txExplorerUrl, leg.error);
      }
      break;
  }
};

const swapOptions: SwapOperationOptions = { ...options, onEvent };
```

Pass `swapOptions` as the second argument to either swap method. Replace the logging with your
application's progress UI; the error example below uses these same options.

Plan step types are `erc20_approval`, `source_approval_signature`, `intent_signature`,
`native_transaction`, `intent_submission`, and `intent_fulfillment`. Event callback failures
do not interrupt the operation. Use `errorDetails` instead of the deprecated step `error` string.

Swap promises resolve after fulfillment with `IntentResult`: `intentId`, `intentExplorerUrl`,
`quote`, `status`, `approvals`, `nativeTransactions`, and optional `attemptId`. Track `attemptId`
alongside `intentId` for support. A rejected promise may follow already-submitted transactions.

## Execute a contract call

```ts
import type { ExecuteParams } from '@avail-project/nexus-core';

declare const contract: ExecuteParams['to'];
declare const calldata: ExecuteParams['data'];
const executeParams: ExecuteParams = {
  toChainId: destination.chainId,
  to: contract,
  data: calldata,
  value: 0n,
  tokenApproval: {
    toTokenAddress: destination.tokenAddress,
    amount: amountRaw,
    spender: contract,
  },
};
const estimate = await client.simulateExecute(executeParams);
const executed = await client.execute(executeParams);
console.log(estimate.estimatedGasUnits, executed.execute.txExplorerUrl);
```

Omit `tokenApproval` when none is required; native-token transfers use `value`. Simulation requires
a wallet and estimates approval gas when needed. Execution returns `execute`, optional `approval`,
and `chainId`. By default it waits for a receipt; `waitForReceipt: false` returns after broadcast.
Receipt controls are `receiptTimeout` (milliseconds, default 300000) and `requiredConfirmations`
(default 1). A submitted transaction can still fail after a broadcast-only result.

## Fund and execute

```ts
const composed = await client.swapAndExecute(
  {
    toChainId: destination.chainId,
    toTokenAddress: destination.tokenAddress,
    toAmountRaw: amountRaw,
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
        allow(); // In an app, call after the user confirms.
      },
    },
  },
);
console.log(composed.swapSkipped, composed.execute.txExplorerUrl);
if (!composed.swapSkipped) console.log(composed.swapResult.intentExplorerUrl);
```

Supply a positive `execute.gas` estimate appropriate to your contract call. The SDK accounts for
execution gas and value, funds the destination shortfall, then executes after fulfillment.
The composite hook receives `intent`, not `quote`; it runs even if funding is already sufficient.
`intent.quote` exists only when `intent.swapRequired` is true.

Composite `refresh(sources?)` returns an updated intent with current fee estimates and a replacement
funding quote when needed. It reuses the original balance snapshot; start a new operation to reread
balances. Omitted sources retain the selection; `[]` clears it. Top-level `beforeExecute` can return
`{ data?, value?, gas? }` after funding, but overrides do not recalculate funding.
Intent events cover funding; the composite promise covers the subsequent contract call too.

## History and errors

```ts
const history = await client.listIntents({ page: 1, status: 'fulfilled' });
console.log(history.intents, history.total);
```

All SDK errors extend `NexusError` and carry `category`, `code`, `context`, and optional `details`.
Use `UserActionError` for denials and `ERROR_CODES` for specific recovery actions.
`getIntentQuoteFailure(error)` extracts structured routing, amount, balance, approval-gas, and price
diagnostics. Handle codes rather than parsing message text. See the [error reference](docs/ERRORS.md).

| Quote error constant (`ERROR_CODES.*`) | Recovery |
| --- | --- |
| `BACKEND_VALUE_ABOVE_CEILING` | Reduce the value; `getIntentQuoteFailure(error)?.details.maxValueUsd` is the USD limit |
| `BACKEND_INPUT_BELOW_DEPOSIT_FEE` | Increase the source amount to cover the deposit fee |
| `BACKEND_NO_ROUTE_TO_DESTINATION` | Choose a destination supported by the allowed providers |
| `BACKEND_NO_ROUTABLE_SOURCE` | Review source verdicts and adjust the sources or mixed failure reasons |

The middleware reports a specific amount or destination failure when all unroutable sources
agree. These failures have `retryable: false`; change the request before retrying. Source verdicts
can include `DESTINATION_NOT_SERVED`. A destination unsupported by every provider still follows
token-not-supported handling.

```ts
import {
  ERROR_CODES,
  NexusError,
  UserActionError,
  getIntentQuoteFailure,
} from '@avail-project/nexus-core';

try {
  const swap = await client.swapWithExactOut(
    {
      toChainId: destination.chainId,
      toTokenAddress: destination.tokenAddress,
      toAmountRaw: amountRaw,
    },
    swapOptions,
  );
  console.log('Fulfilled', swap.intentExplorerUrl);
} catch (error) {
  if (error instanceof UserActionError) {
    console.info('Action declined', error.code);
  } else if (error instanceof NexusError) {
    switch (error.code) {
      case ERROR_CODES.WALLET_NOT_CONNECTED:
        console.info('Connect a wallet, then request a fresh quote.');
        break;
      case ERROR_CODES.BACKEND_INSUFFICIENT_BALANCE:
        console.info('Fund the wallet or choose different source assets.');
        break;
      case ERROR_CODES.BACKEND_INSUFFICIENT_APPROVAL_GAS:
        console.info('Add native gas funds on the source chain or choose another source.');
        break;
      default:
        console.error(error.message, error.code, error.context);
    }

    const failure = getIntentQuoteFailure(error);
    if (failure) console.log('Quote diagnostics', failure.subcode, failure.sourceVerdicts);
    if (error.details?.approvals) console.log('Broadcast approvals', error.details.approvals);
  } else {
    throw error;
  }
}
```

Use the messages to update your UI and retain the error code/context for support. Event handlers
show progress; the operation's promise must still be caught to handle the final failure.

After a timeout or connection failure following commitment, check history, the explorer, and known
transaction hashes before retrying. The intent may still fulfill. Approval failures can expose
`error.details.approvals` with `confirmed`, `reverted`, or `unconfirmed` states. An unconfirmed
transaction may still confirm; use a fresh quote when starting another operation.

Product analytics can be disabled with `analytics: { enabled: false }` in the client config.
Diagnostic logging is configured separately; see the [telemetry reference](docs/TELEMETRY.md).

## Migrating an existing integration

Use address-based swaps for removed `bridge` / `bridgeAndTransfer` methods and `swapAndExecute`
for `bridgeAndExecute`. There is no recipient override or standalone swap simulation method;
use quote review through `onIntent`. `getBalancesForSwap` is a deprecated alias of `getBalances`.

Remove local max/routing helpers, Safe and ephemeral-key configuration, `onAllowance`, and old
bridge/swap plan events. Use `options.hooks`, `IntentQuote`, `IntentEvent`, and `IntentResult`.
Utility functions are available from `@avail-project/nexus-core/utils` and `client.utils`.
