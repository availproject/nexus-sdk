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

- public input validation and catalog lookups;
- response normalization at the transport boundary;
- quote review hooks and quote refresh;
- wallet chain switching, ERC-20 approvals, `personal_sign`, and native transactions;
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
       GET /deployment
       GET /api/v1/better-intent/chains       mainnet/canary only
  -> setEVMProvider(provider)
       bind address + viem wallet client
  -> operations
  -> destroy()
```

`mainnet` and `canary` both enable Better Intent and use mainnet chain catalogs. Other network
hints initialize deployment metadata for execute, but intent operations fail with
`ENVIRONMENT_NOT_SUPPORTED`.

The client is bound to the current wallet provider/address. Recreate it after an account or
provider change.

## Source layout

```text
src/
  abi/          ABIs used by retained contract execution helpers
  analytics/    analytics providers, timing, sessions, and event definitions
  core/         public client assembly, public client types, and SDK utilities
  domain/       shared public types, deployment types, validation, logging, and errors
  execute/      standalone EVM execute runtime
  flows/        thin execute entrypoint and shared execute dependency types
  intent/       Better Intent catalog, types, normalization, funding, wallet, orchestrator
  services/     cross-feature helpers only
  swap/         public swap input types only
  transport/    deployment and Better Intent HTTP client
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

Bridge and swap no longer have parallel runtime packages. Both use the canonical intent path.

## Canonical intent flow

Bridge, exact-output swap, and exact-input swap differ only in public validation and quote-request
construction. They converge at `src/intent/orchestrator.ts`.

```text
public client method
  -> core/sdk/base.ts
       validate input against normalized catalog
       build IntentQuoteRequest
  -> transport.getIntentQuote(...)
       validate raw API response with Zod
       normalize into ExecutableIntentQuote
  -> intent/orchestrator.ts
       emit quote
       onIntent({ quote, refresh, allow, deny })
       resolve allowance amounts
       ERC-20 approvals
       personal_sign
       native source transactions
       submit signed intent
       poll status
       resolve only when fulfilled
```

The quote returned by `refresh()` replaces the complete executable quote atomically. Execution
never combines public fields from one quote with private instructions from another.

The canonical plan is ordered:

1. `erc20_approval` steps with a positive deficit;
2. `intent_signature`;
3. `native_transaction` steps;
4. `intent_submission`;
5. `intent_fulfillment`.

The SDK serializes wallet work through a per-client queue. User callbacks use the non-blocking
callback pattern so event/analytics failures cannot break a flow. Approval hooks are flow-control
hooks and may deliberately allow or reject execution.

## Quote request modes

### Bridge

Bridge resolves the destination token by chain plus symbol, then asks the catalog for same-asset
deployments on selected source chains. It sends an exact-output request.

### Exact-output swap

Exact-output accepts optional source chain/token pairs and a required destination raw amount. If
sources are omitted, the middleware selects usable balances.

### Exact-input swap

Exact-input requires every source chain, token address, and raw amount. The output amount is quoted
by the middleware.

All modes default to 50 basis points of slippage. `forceMayan` becomes a preferred-provider request;
the SDK does not calculate a local threshold or compare provider quotes.

## Public intent model versus executable model

`IntentQuote` is public and contains normalized user-relevant data:

- provider and trade type;
- input legs and required raw amounts;
- output and minimum output;
- normalized fees and allowances;
- expiry;
- canonical plan.

`ExecutableIntentQuote` is internal. It additionally contains the RFF payload, personal-sign
message, approval calldata, native transaction ABI/request data, and provider submission data.

This separation prevents middleware wire details from becoming public API while keeping the
approved quote auditable.

## Balances and catalog

`src/intent/catalog.ts` indexes the normalized chain catalog by chain, address, symbol, and asset
identity. Fungible asset groups are derived from each deployment's `coingeckoId`, matching the
middleware's `/tokens` grouping without a second request. It validates bridge same-asset
relationships and produces bridge source filters.

When `forceMayan` is enabled, the SDK requests Mayan-filtered chains and balances and sends Mayan
as the preferred quote provider. This keeps selectors, holdings, and quote routing on the same
provider catalog.

`getBalancesForBridge()` and `getBalancesForSwap()` call the same provider-backed balances endpoint
and return chain-level `IntentBalance[]` values.

`getSupportedChains()` merges Better Intent catalog chains with execute deployment chains. Each
result contains explicit `capabilities.intent` and `capabilities.execute` flags.

`getSupportedChainsForRoute()` forwards the user's current source/destination constraints to
`/better-intent/chains`. The middleware remains the source of truth for provider compatibility and
returns directional `asSource`/`asDestination` support. The SDK keeps `providers` as the union of
those fields for compatibility with existing consumers.

Quote responses normalize `sourceVerdicts`. Structured quote failures are retained on the SDK
error and exposed through `getIntentQuoteFailure`, including the middleware subcode, error ID,
source verdicts, provider reasons, and whether retrying may help.

## Composite intent plus execute

`bridgeAndExecute` and `swapAndExecute` retain a small amount of local calculation because the SDK
must know what the later contract call needs.

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

Execute uses deployment chain metadata and is independent of Better Intent availability.

## Transport boundary

`src/transport/middleware.ts` exposes only:

- deployment metadata;
- Better Intent chains;
- Better Intent balances;
- quote;
- submit;
- status;
- Nexus and external-provider history.

Every raw response is parsed and normalized in `src/intent/normalize.ts`. Addresses are canonical
lowercase `Hex`, chain references become numeric EVM chain IDs, and decimal integer strings become
`bigint`.

HTTP and schema failures become categorized `BackendError` values with middleware correlation
details where available.

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
