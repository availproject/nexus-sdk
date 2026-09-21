# Nexus SDK Architecture

This document describes the API-first Nexus SDK after the Better Intent refactor.

## Responsibility split

The Better Intent middleware owns:

- supported intent chains and tokens;
- balance-aware source selection;
- route and provider selection;
- exact-input and exact-output quote calculation;
- fees, allowances, signing instructions, and native source transaction instructions;
- intent status and history.

The SDK owns:

- public input validation, cached catalog lookups, and directional provider prechecks;
- response normalization at the transport boundary;
- quote review hooks and quote refresh;
- wallet chain switching, ERC-20 approvals, EIP-712 permits, `personal_sign`, and native transactions;
- intent submission and fulfillment polling;
- standalone contract execution;
- destination shortfall calculation for intent-plus-execute operations;
- analytics, timing, errors, and public client assembly.

There is no local route engine, quote engine, aggregator selection, Safe path, ephemeral wallet, or
legacy fallback.

## Public client lifecycle

```text
createNexusClient(config)
  -> initialize()
       GET /api/v1/intent/chains       chain and execution metadata
       GET /api/v1/intent/tokens       all pages, joined by chain ID
  -> setEVMProvider(provider)
       bind address + viem wallet client
  -> operations
  -> destroy()
```

`mainnet` and `canary` both enable Better Intent and use mainnet chain catalogs. Other network
hints initialize the same catalog endpoints for execute metadata, but intent operations fail with
`ENVIRONMENT_NOT_SUPPORTED`.

The client is bound to the current wallet provider/address. Recreate it after an account or
provider change.

## Source layout

```text
src/
  abi/          ABIs used by retained contract execution helpers
  analytics/    analytics providers, timing, sessions, and event definitions
  core/         public client assembly, public client types, and SDK utilities
  domain/       shared public types, validation, logging, and errors
  execute/      standalone EVM execute runtime
  flows/        thin execute entrypoint and shared execute dependency types
  intent/       Better Intent catalog, types, normalization, funding, wallet, orchestrator
  services/     cross-feature helpers only
  swap/         public swap input types only
  transport/    Better Intent HTTP client
```

## Dependency direction

- `src/core/` is the assembly layer and may depend on all lower packages.
- `src/intent/` owns all cross-chain intent behavior.
- `src/execute/` and `src/flows/execute.ts` own standalone destination execution.
- `src/transport/` validates and normalizes external responses before returning them.
- `src/domain/` contains shared primitives and must not depend on assembly code.
- `src/services/` contains only helpers used across features.
- Lower packages must not import `src/core/`.
- `src/services/` must not import `src/flows/`.

All swap modes use the canonical intent path; there is no separate bridge API or runtime.

## Canonical intent flow

Exact-output and exact-input swaps differ only in public validation and quote-request construction.
They converge at `src/intent/orchestrator.ts`, including same-asset cross-chain swaps.

```text
public client method
  -> core/sdk/base.ts
       validate input and directional provider support against the cached catalog
       build IntentQuoteRequest
  -> transport.getIntentQuote(...)
       validate raw API response with Zod
       normalize into ExecutableIntentQuote
  -> intent/orchestrator.ts
       emit quote
       onIntent({ quote, refresh, allow, deny })
       resolve allowance amounts
       serialize ERC-20 approval broadcasts or EIP-712 permit signatures
       confirm broadcast approvals concurrently outside the wallet queue
       recheck quote expiry after all approvals confirm
       personal_sign
       native source transactions
       submit signed intent
       poll status
       resolve only when fulfilled
```

The quote returned by `refresh()` replaces the complete executable quote atomically. Execution
never combines public fields from one quote with private instructions from another.

The canonical plan is ordered:

1. `erc20_approval` or `source_approval_signature` steps with a positive deficit;
2. `intent_signature`;
3. `native_transaction` steps;
4. `intent_submission`;
5. `intent_fulfillment`.

The SDK serializes wallet prompts and chain switches through a per-client queue. Each ERC-20
approval releases the queue when its transaction hash is available. Receipt checks use the source
chain's public RPC client and overlap with later approval prompts and confirmations. Approval
completion events may arrive out of order; the successful result retains submission order.

Intent signing waits for all required approvals to confirm and for a fresh expiry check. On an
approval failure, the orchestrator settles all submitted receipt checks and includes their hashes
and confirmed/reverted/unconfirmed states in `NexusError.details.approvals`, preserving the error's
category and code. It stops further approval prompts once failure is known and does not resend
transactions automatically. Native source transactions still wait for receipts inside the wallet
queue.

User callbacks use the non-blocking callback pattern so event/analytics failures cannot break a
flow. Approval hooks are flow-control hooks and may deliberately allow or reject execution.

## Quote request modes

### Exact-output swap

Exact-output accepts optional source chain/token pairs and a required destination raw amount.
The SDK filters cached assets against the destination's providers, restricted to user-selected
sources when supplied. Compatible tokens are deduplicated and grouped by chain in the quote request.
No surviving source is a local `INVALID_INPUT` error; the SDK never turns that into an unconstrained
request. Different candidate sources can use different providers, since middleware may choose a subset.
Middleware selects usable balances within those filters.

### Exact-input swap

Exact-input requires every source chain, token address, and raw amount. The SDK intersects all
source providers with the destination providers and rejects an empty intersection with
`INVALID_INPUT`. Support must exist at both chain and token level in the correct direction.
The output amount is quoted by middleware. Both modes repeat their checks for hook-driven refreshes
without additional catalog or balance requests.

All modes default to 50 basis points of slippage. Middleware selects the quote provider;
the SDK does not calculate a local threshold or compare provider quotes.

## Public intent model versus executable model

`IntentQuote` is public and contains normalized user-relevant data:

- provider and trade type;
- input legs and required raw amounts;
- output and minimum output;
- normalized fees and allowances;
- expiry;
- canonical plan.

`ExecutableIntentQuote` is internal. It additionally contains the RFF payload,
`requiredSignatures` with personal-sign or EIP-712 data, approval calldata, native transaction
ABI/request data, and provider submission data. Submission echoes each signature's identity with
the produced signature, excluding its signing data.

This separation prevents middleware wire details from becoming public API while keeping the
approved quote auditable.

## Balances and catalog

`src/intent/catalog.ts` resolves normalized chain metadata and token metadata by chain ID and
contract address. It does not group tokens by symbol or infer cross-chain fungibility.

The transport loads chain metadata and paginated tokens separately, normalizes both responses, and
joins tokens by chain ID. It rejects incomplete pagination rather than exposing a partial catalog.

Initialization requests the full catalog once and builds `chainList` from its RPC, vault, multicall,
native currency, and execution flags. Native and ERC-20 Nexus currency IDs come from token provider
support. `knownTokens` retains Nexus-supported ERC-20s, matching the old deployment token set;
external catalogs contain duplicate symbols that must not replace execute's known token identities.
Native entries are kept out of `knownTokens` to preserve native-token lookup semantics.
The standalone chain utility uses these endpoints too; there is no `/deployment` client.

Catalog discovery and balance requests include all supported providers. Explicit provider
constraints on `getSupportedChainsForRoute()` are forwarded to middleware for that request.

`getBalancesForSwap()` calls the provider-backed balances endpoint and returns chain-level
`IntentBalance[]` values.

`getSupportedChains()` merges intent-enabled catalog chains with executable catalog chains. Each
result contains explicit `capabilities.intent` and `capabilities.execute` flags.

The synchronous client helpers `getTokensByChain`, `getAvailableSourceTokens`,
`getAvailableDestinationTokens`, and `confirmRouteExists` also use the initialization cache. Catalog
filtering lives in `src/intent/catalog.ts`; `src/core/` enforces the initialization guard.
Source candidates are grouped by provider and can be narrowed by existing
selections without removing selected tokens. Destination candidates form one list after intersecting
every source's provider support. Both directions intersect chain and token metadata.
`confirmRouteExists` shares the provider intersection used by exact-input prechecks. Exact-output
sources remain alternative candidates with individual destination compatibility. These helpers need
no wallet or network calls, and UI provider groups do not constrain quote provider selection.

The standalone `getSupportedChains(network, { clientId })` utility and `client.utils.getSupportedChains(network)`
fetch their own catalog. `src/services/chains.ts` preserves chain and token directional support
while returning the existing utility shape, including token `contractAddress` and execution token
metadata. Directional arrays come from the catalog, including explicit empty arrays.

`getSupportedChainsForRoute()` forwards the user's current source/destination constraints to
`/intent/chains`. The middleware remains the source of truth for provider compatibility and
returns directional `asSource`/`asDestination` support at the chain level. `/tokens` accepts provider
filters, but no route constraints: token support remains general catalog availability. The SDK
uses this endpoint only when explicitly requested, not during swaps. Cached provider intersections
are preliminary checks; quote requests retain currency, amount, balance, and route feasibility checks.
The SDK keeps `providers` as the union of directional fields.

Quote responses normalize `sourceVerdicts`. Structured quote failures are retained on the SDK
error and exposed through `getIntentQuoteFailure`, including the middleware subcode, error ID,
source verdicts, provider reasons, and whether retrying may help.
Pre-routing quote failures such as insufficient balance or approval gas use the same helper and keep
their endpoint-specific payload in `details`.

`src/transport/middleware.ts` maps Better Intent HTTP error envelopes into `BackendError`s with
display-ready messages and specific `ERROR_CODES`. Recognized subcodes take precedence over general
middleware codes; related provider subcodes share an SDK code. The original message, codes, error ID,
HTTP status, and diagnostic details remain available on the error. Unknown errors use the server's
message when present, then HTTP/network or operation-specific fallbacks. Already-classified SDK errors
pass through unchanged, including local validation failures before an HTTP call.

## Composite intent plus execute

`swapAndExecute` retains a small amount of local calculation because the SDK must know what the
later contract call needs.

```text
fetch fresh destination balances + simulate execute gas
  -> calculate destination token/native shortfall
  -> skip intent if fully funded
  -> otherwise request only the shortfall through canonical intent flow
  -> wait for fulfilled
  -> run optional beforeExecute hook
  -> execute destination transaction
```

Native-token output combines the contract value and gas requirement. If only gas is missing and
the funding token is non-native, the request uses one raw output unit plus the provider gas-drop
amount so the intent remains valid.

Composite operations do not build routes locally.

## Standalone execute

`src/flows/execute.ts` validates `ExecuteParams`, resolves optional token approval metadata,
estimates fees for simulation, and delegates transaction preparation/sending to
`src/execute/runtime.ts`.

Execute uses cached chain metadata and is independent of intent route availability.

## Transport boundary

The public client requires `clientId`. Its middleware transport sends
`x-nexus-client-id`, `x-nexus-surface: nexus-sdk`, and the package version in
`x-nexus-surface-version` through shared HTTP headers. The standalone catalog utility takes
`{ clientId }`; client utilities bind the configured ID.

`src/transport/middleware.ts` exposes only:

- Better Intent chains with their separately loaded token catalog;
- Better Intent balances;
- quote;
- submit;
- aggregate status plus per-leg intent detail;
- Nexus and external-provider history.

Every raw response is parsed and normalized in `src/intent/normalize.ts`. Addresses are canonical
lowercase `Hex`, chain references become numeric EVM chain IDs, and decimal integer strings become
`bigint`.

Status polling combines `/intent/status/:id` with `/intent/rff/:id`. The first is the
aggregate lifecycle view; the second supplies normalized per-source leg status and transaction data.

HTTP and schema failures become categorized `BackendError` values with middleware correlation
details where available.

## Payment reporting

`src/core/sdk/operation-boundary.ts` creates one attempt ID and reporting observer per public swap
call, before local checks or network requests. `src/intent/telemetry.ts` owns commitment, route,
delivery, and outcome observations. The orchestrator reports independently of user callbacks.
Base passes that same ID to quote, refresh, submit, status/detail, and composite funding requests
as per-request `x-request-id`. Signed payloads are unchanged. Optional network timing uses this ID
as its parent operation.

Only canonical `INTENT_OUTCOME` events count terminal payment outcomes. Polling uncertainty is an
observation error. `swapAndExecute` records payment completion at destination delivery, before
standalone execution; skipping the swap records `INTENT_SKIPPED` and no payment outcome.
Partial balance reporting retains the transport's `errored` flag internally while the public
balance method still returns an array.

`src/services/error-reporting.ts` maps existing public errors to internal reason buckets.
`AnalyticsManager` supplies client identity and session on each record; the shared OTel resource
contains no generated client ID or first-client network. See [TELEMETRY.md](TELEMETRY.md) for
the schema and the remaining middleware reconciliation work.

## History

History requests both Better Intent history feeds, normalizes provider identity, merges the records,
sorts newest first, and adds the configured intent explorer URL. The public method preserves the
existing page-based entrypoint.

## Tests

The retained suite follows the runtime boundaries:

- `tests/intent/normalize.test.ts` — external response contracts;
- `tests/transport/better-intent.test.ts` — endpoint and request contracts;
- `tests/intent/catalog.test.ts` — token identity and merged capabilities;
- `tests/intent/orchestrator.test.ts` — approval/sign/send/submit/poll ordering;
- `tests/intent/wallet.test.ts` — wallet validation and transaction behavior;
- `tests/intent/funding.test.ts` — composite shortfall invariants;
- `tests/core/sdk-better-intent.test.ts` — public assembly and network behavior;
- `tests/public-api.test.ts` — exported surface guardrails.

See [Testing Strategy](../tests/TESTING.md) and [Conventions](CONVENTIONS.md).
