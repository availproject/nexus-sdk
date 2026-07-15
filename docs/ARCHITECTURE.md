# Nexus SDK Architecture (v2)

This document is the canonical overview of how the Nexus SDK is structured and how requests flow
through the system. It is intended to help developers and LLMs understand the codebase quickly.

## Scope and goals

- Provide a headless TypeScript SDK for cross-chain operations on EVM chains.
- Keep a functional architecture with clear package boundaries.
- Use pure functions unless absolutely necessary.
- Keep flow entrypoints thin and feature internals local to their feature package.
- Make flows testable and services reusable.
- Keep the public API stable (unless explicitly changed).

## Public API surface (high level)

The SDK exposes a single factory: `createNexusClient`.

The returned `NexusClient` includes:
- `initialize(): Promise<void>` (fetches deployment data; must be called before chain-dependent ops)
- `setEVMProvider(provider): Promise<void>`
- `isSupportedChain(chainId): boolean`
- `bridge(params, options?)`
- `bridgeAndTransfer(params, options?)`
- `bridgeAndExecute(params, options?)`
- `execute(params, options?)`
- `swapWithExactIn(params, options?)`
- `swapWithExactOut(params, options?)`
- `swapAndExecute(params, options?)`
- `calculateMaxForSwap(params)`
- Simulation variants: `simulateBridge`, `simulateBridgeAndTransfer`, `simulateBridgeAndExecute`, `simulateExecute`
- `getBalancesForBridge()`
- `getBalancesForSwap()`
- `listIntents(params?)`
- `getSupportedChains()`
- `convertTokenReadableAmountToBigInt(amount, tokenSymbol, chainId)`
- `chainList`, `utils`, `analytics`, `destroy()`, `hasEvmProvider`

## Client lifecycle

1) Create the client
2) Call `initialize()` to load deployment data (chains/tokens)
3) Call `setEVMProvider(provider)` to bind the wallet

The client is disposable and should be treated as bound to the current provider/address. On account
change, create a new client, call `initialize()`, then call `setEVMProvider(provider)` again.

The SDK does not persist flow/runtime state across client instances, but swap flows may cache
derived-key signature material in local storage so an ephemeral wallet can be reconstructed for the
same address. Call `destroy()` when you are done to end analytics sessions.

## Folder structure

```
src/
  abi/          Contract ABIs used by flows and services
  analytics/    Analytics, timing, and provider integrations
  bridge/       Bridge-specific internals (preview, intent builders, hooks, allowances, progress)
  core/         Public SDK surface, event adapters, and shared client types
    sdk/        Base state/operation layer + public client factory implementation
  domain/       Types, constants, errors, validation, chain metadata
  execute/      Shared execute runtime and execute-progress mapping
  flows/        Thin public orchestration entrypoints, shared deps, and composition wrappers
  services/     Cross-feature helpers only (timing, balances, intents, pricing, etc.)
  swap/         Swap-specific route, preflight, execution, progress, and wallet logic
    routing/     Mode-owned Exact In/Exact Out routing plus shared routing mechanics
    execution/   Feature-owned source/bridge/destination stages and their orchestrator
  transport/    Middleware + simulation clients, including shared WS request lifecycle
```

## Package boundaries

The codebase is organized as layered feature packages, not as a flat bag of helpers.

- `src/core/` is the top assembly layer. It may depend on `flows`, `bridge`, `execute`, `swap`,
  `services`, `transport`, and `domain`.
- Lower layers must not depend on `src/core/`.
- `src/flows/` is for thin entrypoints and public composition surfaces. Reusable feature logic
  should not live here.
- `src/bridge/` owns bridge-specific internals: intent assembly, hook state, allowance
  preparation, execution, progress mapping, and bridge-only adapters.
- `src/execute/` owns reusable execute internals shared by composed flows.
- `src/swap/` owns swap-specific planning, preflight, execution, and progress logic. Its
  `route.ts` is a stable facade over `routing/exact-in.ts` and `routing/exact-out.ts`, while
  `execution/orchestrator.ts` owns the source → bridge → destination sequence and failure cleanup.
- `src/services/` contains cross-feature helpers only. Swap-only and bridge-only modules should not
  live there.
- `src/transport/` and `src/domain/` must not import from `src/flows/`.
- `src/flows/deps.ts` is the shared home for internal flow dependency shapes.

Shared timing helpers now live in `src/services/timing.ts`, so `bridge`, `execute`, and `flows`
can reuse timing spans without introducing `src/* -> src/flows/*` utility dependencies.

## Request flow overview

Bridge flow (simplified):

```
createNexusClient
  -> core/sdk/client.ts
     -> core/sdk/base.ts
        -> flows/bridge.ts
           -> bridge/preview.ts
           -> bridge/intent/builder.ts
           -> bridge/intent/creator.ts
           -> bridge/hooks/state.ts
           -> bridge/hooks/approval.ts
           -> bridge/allowances/prepare.ts
           -> bridge/executor.ts
           -> wait for fulfilment
```

Execute flow (simplified):

```
execute(params)
  -> core/sdk/base.ts
     -> flows/execute.ts
        -> execute/runtime.ts
           -> createExecuteTxContext(...)
           -> createExecutePlanContext(...)
           -> sendExecuteTransactions(...)
```

Bridge + execute flow combines both: it bridges to the destination chain and then executes a
transaction using the bridged funds.

Bridge + execute flow (simplified):

```
bridgeAndExecute(params)
  -> core/sdk/base.ts
     -> flows/bridge-and-execute.ts
        -> flows/bridge.ts
        -> flows/execute.ts
        -> services/balances.ts
```

Swap flow (simplified):

```
swap(params)
  -> flows/swap.ts
     -> swap/preflight.ts
     -> swap/route.ts: determineSwapRoute(...)
        -> swap/routing/exact-in.ts | exact-out.ts
     -> createSwapIntent(...)
     -> onIntent({ allow, deny, refresh, intent })
     -> swap/prepare.ts: prepareSwapExecution(...)
     -> swap/execution/orchestrator.ts: executeSwapRoute(...)
        -> executeSourceSwaps(...) | executeDirectDestinationExactOut(...)
        -> executeSwapBridge(...) when routed
        -> executeDestinationSwap(...)
        -> cleanupStrandedCot(...) on stage failure
     -> finalizeSwapResult(...)
```

`swapAndExecute` composes swap planning with an execution request on the destination chain.
`calculateMaxForSwap` reuses swap preflight and route logic to estimate the maximum usable input.

Swap execution assumes the user's EOA wallet has one mutable active-chain context. Work that touches
the EOA wallet must therefore be sequential across chains, including chain switching, wallet
prompts, permit signatures, direct approvals, and EOA transaction dispatch. Swap internals may still
parallelize non-EOA work such as route requests, public-client reads, ephemeral SBC construction,
per-chain SBC submission, and receipt waits. The native-token ephemeral source path has one explicit
ordering requirement: if the ephemeral account is not delegated, the SDK sends and confirms an
empty-calls SBC before prompting the EOA to send the payable execute transaction.

`base.ts` now assembles explicit flow deps (`chainList`, `timing`, `intentExplorerUrl`, `evm`,
`middlewareClient`, and swap runtime deps where needed) and delegates to plain flow functions
instead of building query objects or factory-returned method bags.

## Hooks (per-operation)

Hooks are per operation (not global). Provide hooks via options when calling operations:

- `onIntent({ allow, deny, refresh, intent })`
- `onAllowance({ allow, deny, sources })`

If no hooks are provided, the SDK auto-accepts intent and allowance.

`refresh()` re-builds the intent (ex: when a UI changes source chain selection). It is safe until the
intent is accepted.

For swap operations, the exposed hook is `onIntent(...)`. Swap does not expose a separate
`onAllowance` hook; allowance and permit handling are part of swap execution preparation.

Bridge hook internals are split by responsibility:

- `bridge/hooks/state.ts` derives hook state from an intent
- `bridge/hooks/approval.ts` resolves `onIntent` and `onAllowance`
- `bridge/hooks/defaults.ts` provides default auto-accept behavior
- `bridge/allowances/prepare.ts` handles paid ERC20 approval execution
- `bridge/allowances/prepare-swap-sbc.ts` handles swap-specific SBC approval fallback

## Transport (middleware + simulation)

Middleware client (`createMiddlewareClient`) validates URLs once and provides:

- `getDeployment()` -> `GET /deployment`
- `getBalances(address, universe)`
- `listRFFs(params)` -> `GET /api/v1/rffs`
- `getRFF(hash)` -> `GET /api/v1/rff/:hash`
- `submitRFF(payload)` -> `POST /api/v1/rff`
- `createApprovals(approvals)` -> `POST /api/v2/create-sponsored-approvals`
- `submitSBCs(sbcTxs)` -> `POST /api/v2/create-sbc-tx`
- `getQuote(request)` -> `POST /api/v1/quote`
- `getSwapBalances(address)` -> `GET /api/v1/swap-balance/EVM/:address`
- `simulateBundleV2(request)` -> `POST /api/v1/gas/bundle-v2`

It also exposes aggregator quote proxies, lightweight LiFi/Relay token-price proxies used by Exact
Out routing, oracle-price fetches, timing configuration, and `destroy()` for transport teardown.
Citrea token pricing is fetched directly from `graph.fibrous.finance` by the swap routing package;
Fibrous quote requests continue to use their separate quote API through middleware.

Every middleware error is normalized at this boundary: axios failures are wrapped in a `BackendError`
whose `details` carry the middleware's typed error envelope (`middlewareCode`, `middlewareSubcode`,
`errorId`, `middlewareDetails`) when present — see `middlewareErrorDetails` in
`src/transport/middleware.ts` and the middleware-error model in `src/domain/types/middleware-error.ts`.
The `errorId` is the correlation key between SDK and middleware logs.

List RFFs params:

- `user` (hex address)
- `status` ("created" | "deposited" | "fulfilled" | "expired")
- `deposited` (boolean)
- `fulfilled` (boolean)
- `limit`, `offset`

Response: `{ rffs: V2RffResponse[], total: number }`.

Simulation client calls the backend simulation service (Tenderly) and is used by simulation flows.

## Data model notes

- `Intent` is the internal representation of a bridge intent.
- `V2Request` is the middleware API request format.
- `depositRequest` is the on-chain request used for vault deposits.
- Middleware balance responses use string universes (`EVM`, `TRON`, `FUEL`, `SVM`) and raw balances.
  The SDK normalizes universes to internal enums and scales balances by token decimals.

## Errors and validation

- Errors are categorized subclasses of the generic `NexusError<C>` (see `domain/errors.ts`):
  `ValidationError`, `UserActionError`, `SimulationError`, `ExecutionError`, `BackendError`,
  `ExternalServiceError`, `InternalError`. Each carries a stable code (`category/specific_…`)
  and a narrowed `context.service` (`'wallet' | 'rpc' | 'middleware' | 'lifi' | 'bebop' |
  'coinbase' | 'hook'` depending on category).
- External calls are wrapped with the right category-specific helper
  (`Errors.backendWithCause(... { service: 'middleware' })`,
  `Errors.executionWithCause(... { service: 'wallet' | 'rpc' })`, etc.) — not the legacy
  `internalWithCause`, which is reserved for SDK invariants.
- Inputs are validated with shared Zod validators in `domain/utils/validation.ts`.
- User rejection errors from wallet providers may be nested; use `error.walk(...)` /
  `error.find(Sub)` to traverse the chain. `error.toString()` and `JSON.stringify(error)`
  render the full chain via native ES2022 `cause`.

OTel boundary emission for every public method + the two exported utilities
(`getCoinbaseRates`, `getSupportedChains`) is handled by
`src/services/error-telemetry.ts:reportOperationError`. It emits a single flat OTel log per
failure with stable attributes (`operation`, `error.category`, `error.code`, `error.service`,
flattened `params.<allowlisted-key>` / `options.<allowlisted-key>`, plus the full sanitized
blob in `params.raw` / `options.raw`). The OTel logger is provisioned by
`services/telemetry.ts:setLoggerProvider`, called idempotently from both `initialize()` and
`setEVMProvider()`. See [`src/domain/errors.md`](../src/domain/errors.md) for the OTel surfacing details.

## Chain and token metadata

- Chains and token metadata are fetched from the middleware deployment endpoint during
  `initialize()`.
- `src/services/chain-list.ts` converts the deployment response into the runtime `chainList`
  structure used by the SDK.
- The SDK does not treat local source files as the source of truth for supported chains/tokens.
- `chainList.getChainByID` throws if a chain id is not supported.
- `convertTokenReadableAmountToBigInt` converts human amounts to raw units using token decimals.

## Extending the SDK

Common extensions:
- Add or change a chain/token for an existing supported universe: update the middleware deployment
  response; the SDK will pick it up on `initialize()`.
- Add a new universe or new runtime capability: update the SDK's universe mappings, address
  conversion utilities, and any flow/runtime code that depends on that universe.

Keep package boundaries intact when extending the SDK:

- `src/services/` should remain cross-feature.
- `src/bridge/` is the home for bridge-only internals.
- `src/swap/` is the home for swap-only internals.
- `src/execute/` is the home for shared execute machinery.
- `src/flows/` should only gain thin entrypoints or public composition wrappers.
- `src/core/sdk/` should stay as thin orchestration and public client assembly.

## Testing and CI

- Unit tests: `vitest`
- Type checking: `tsc --noEmit`
- Linting: `biome`
- CI runs lint, typecheck, and tests on every PR and push to `main`.

## Glossary

- RFF: Request for Funds (bridge request)
- Middleware: Nexus backend that provides balances, RFF indexing, approvals
- Vault: On-chain contract that accepts deposits for bridging
