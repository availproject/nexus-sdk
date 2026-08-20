# Better Intent SDK follow-up improvements

This is a cleanup and improvement report only. It does not propose changing runtime behavior in the
current integration branch.

## Current API wiring

The SDK currently uses:

- `GET /deployment` for standalone execute chain and contract metadata.
- `GET /api/v1/better-intent/chains` for the intent catalog and constrained selector options.
- `GET /api/v1/better-intent/balances/:account` for wallet holdings.
- `POST /api/v1/better-intent/quote` for exact-input and exact-output quotes.
- `POST /api/v1/better-intent/submit` to submit the signed intent.
- `GET /api/v1/better-intent/status/:id` while waiting for fulfillment.
- `GET /api/v1/better-intent/rffs` and `/rffs-external` for combined history.

The middleware URL for the `internal-mainnet` deployment is the existing canary URL:
`https://nexus-v2.canary.avail.so/middleware`.

## Recommended improvements

### 1. Remove the remaining `/tokens` compatibility code

Runtime no longer calls `/tokens`. Fungible asset groups are derived from `/chains` using
`coingeckoId`, with symbol as the current fallback.

The old `normalizeIntentTokens` schema, exported catalog type, and related tests still remain. Once
the team confirms no internal consumer imports them, remove that dead path so the code reflects the
actual API contract.

Risk to check first: symbol fallback can incorrectly group unrelated assets that share a ticker.
Ideally the API should always provide a stable asset or fungibility ID.

### 2. Make directional provider fields the only catalog contract

The new API returns `asSource` and `asDestination`. The SDK currently also builds `providers` as
their union for compatibility with older consumers and older middleware responses.

After the rollout window, deprecate and remove `providers`. UI code should always use the field for
the role being selected. This avoids treating a destination-only token as a valid source.

### 3. Replace `forceMayan` with normal provider constraints

`forceMayan` is a legacy global switch. The new `/chains` contract and quote request already support
provider constraints.

Prefer a general provider policy in client or operation options, then deprecate `forceMayan`. Do not
filter to Mayan by default: the normal flow should allow every available provider and let middleware
select the route.

### 4. Consolidate the two balance methods internally

`getBalancesForBridge()` and `getBalancesForSwap()` call the same endpoint and currently return the
same data. Keep the public aliases if applications need them, but implement one internal balance
operation and document whether the two methods are expected to diverge later.

### 5. Give constrained catalog requests normal operation telemetry

`getSupportedChainsForRoute()` is an asynchronous public SDK method, but it does not yet have a
dedicated analytics event set. Add timing, success, and failure telemetry so catalog latency and API
errors can be diagnosed in FastBridge.

### 6. Formalize structured middleware errors across endpoints

Quote failures now have `getIntentQuoteFailure()`, including routing, balance, approval-gas, and
price failures, which is better than parsing message strings.
Apply the same pattern to balances, submit, status, and catalog failures if their API contracts gain
stable subcodes and details. Keep human-readable messages for display and structured fields for UI
decisions.

### 7. Clarify and eventually simplify history aggregation

The SDK currently calls `/rffs` and `/rffs-external` in parallel, adds both totals, concatenates the
records, and sorts the current page locally.

This can produce incorrect global pagination or duplicate records if a request appears in both
feeds. Ideally middleware should expose one paginated, deduplicated history endpoint. Until then,
define a stable deduplication key and pagination rule before changing the SDK.

### 8. Remove old middleware-response fallbacks after rollout

The chain normalizer accepts both the old `providers` response and new directional fields so the SDK
works while environments are on different API versions. Once all supported environments return the
new contract, make `asSource` and `asDestination` required and delete the fallback. This will surface
deployment mismatches immediately instead of silently accepting old data.

### 9. Separate intent catalog data from execute-only chains more clearly

`getSupportedChains()` merges intent chains with deployment chains and marks capabilities. This is
useful but easy for UI consumers to misuse if they forget to check `capabilities.intent`.

Consider clearer names or dedicated accessors for intent-route options versus execute-only support.
The constrained method should continue returning only the middleware intent catalog.

### 10. Add live contract tests for the release environment

Unit tests cover query serialization and response normalization. Add a non-wallet smoke test against
the release middleware that verifies:

- constrained `/chains` returns directional provider fields;
- repeated source and destination constraints are accepted;
- an empty directional array is preserved;
- quote errors retain subcode, source verdicts, provider reasons, and error ID.

Keep transaction execution in a separate funded-wallet test because it mutates chain state.

## Suggested order

1. Integrate the new SDK catalog fields into FastBridge and run selector/quote tests.
2. Confirm the history ownership and pagination contract with the middleware team.
3. Confirm every supported environment has the new directional `/chains` response.
4. Remove `/tokens` leftovers and old `providers` response fallbacks.
5. Consolidate balances, improve telemetry, and remove other compatibility code.
