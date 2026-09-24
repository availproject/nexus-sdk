# SDK payment reporting contract

This implements the SDK portion of `ai-error-1.md`. `ai-error-2.md` describes older implementations;
its bridge-specific event names and timeout paths do not apply to the current intent runtime.

## Identity and correlation

Every client event and operation error log carries `nexus.client.id`, `surface.name: nexus-sdk`,
`surface.version`, `session.id`, and `nexus.network`. Client identity is the configured value, not a
generated browser ID or hostname. The shared OTel resource retains the SDK service identity and
package version; client/session/network attribution belongs on each record.

The SDK sends `x-nexus-client-id`, `x-nexus-surface`, and `x-nexus-surface-version` on intent HTTP
requests. Standalone `getSupportedChains(network, { clientId })` takes explicit identity;
`client.utils.getSupportedChains(network)` uses its client configuration. Stateless utilities
have no SDK session to attach. Their diagnostic logs remain separate from client operation logs.

Each public swap call creates one `attempt.id`, reusing the operation's ID. It exists before local
validation and the first quote. All quote refreshes, submit, status/detail polling, and composite
funding requests send it in the `x-nexus-attempt-id` header. IDs are supplied per request, so
concurrent operations cannot overwrite one another. A new call gets a new ID. The SDK does not
set `x-request-id` for attempt correlation; that header is reserved for individual HTTP requests.
Optional network timing spans use the attempt as their parent operation.

`quote.id` links each accepted quote, `intent.id` links the committed intent, and transaction
observations preserve complete `transaction.hash` values. These fields, and `operation.id`, are
join keys on records, never metric labels. No identity/correlation field is added to signed RFFs,
signature envelopes, or protocol transaction payloads. Hooks and successful results expose
`attemptId` for support correlation.

## Outcomes and authority

All attempt events carry `nexus.telemetry.schema.version: 1` and `attempt.kind` identifying
`swapWithExactIn`, `swapWithExactOut`, or `swapAndExecute`. **Only
`nexus_v2_intent_outcome` is a terminal outcome event.** It includes `attempt.outcome`,
`attempt.committed`, `attempt.pending`, `attempt.duration_ms`, and `attempt.outcome_authority`.

| Outcome | SDK observation | Authority |
| --- | --- | --- |
| `stopped` | A typed user decline before commitment | SDK |
| `rejected` | Any other operation error before commitment | SDK |
| `completed` | Middleware reports destination fulfillment | Middleware |
| `failed` | Middleware reports terminal expiry | Middleware |

ERC-20 intent signing commits the payment; allowance approval and permit signatures do not.
Native-only payment commits at deposit broadcast, before receipt confirmation. In a mixed-source
payment, the ERC-20 intent signature commits. All sources contribute to one attempt.

An exception after commitment without a terminal status emits
`nexus_v2_intent_observation_failed` with `attempt.pending: true` and
`error.retryability: check_status`. It does not assert that the payment failed or trigger a retry.
This includes submission uncertainty, native receipt failures, polling errors, and local timeout.
Detailed errors continue to reach OTel and the caller receives the original SDK error.

Delivery closes the payment attempt before solver settlement or a subsequent destination execute
call. A later `swapAndExecute` execution error retains the completed payment outcome and emits the
composite operation failure. A swap skipped because destination funding is already sufficient
emits `nexus_v2_intent_skipped`, with no terminal payment outcome.

Compute payment failure rate from reconciled unique attempts: `failed / (completed + failed)`.
Stopped, rejected, skipped, and unresolved attempts do not enter that denominator. Report rejection
counts/distributions separately by session and reason. No escalation threshold is configured.
Existing session `successRate` and operation timing `success` describe SDK operations, not payment
reliability; they must not be used for this formula.

## Events and route context

Event names below all use the `nexus_v2_` prefix.

| Suffix | Meaning |
| --- | --- |
| `intent_started` | Public swap call begins |
| `intent_quoted` | Initial or refreshed executable quote accepted; one record per distinct source chain/token pair and one for the destination |
| `intent_quote_refresh_failed` | Refresh failed; the hook may recover within this attempt |
| `intent_committed` | First commitment point reached |
| `intent_transaction` | Approval/source transaction broadcast, including its hash |
| `intent_source_status` | A source status or transaction hash changed |
| `intent_delivered` | Destination fulfillment observed |
| `intent_outcome` | One terminal payment outcome |
| `intent_observation_failed` | SDK lost progress after commitment; terminal outcome unknown |
| `intent_skipped` | Composite operation needed no swap |
| `balances_fetch_partial` | Middleware returned available balances with `errored: true` |

Quote observations use `chain.id`, `chain.role: source | destination`, and `token.address`.
Each accepted quote emits one record per distinct source chain/token pair and one destination
record, even when the destination uses the same chain and token as a source. Multiple tokens on
one chain get separate records; repeated occurrences of the same source pair share one record.
Token addresses come from the normalized quote. These records share `attempt.id`, `quote.id`,
`provider.name`, paired `sources: [{ chainId, tokenAddress }]`, and `toTokenAddress`. Quote records
omit `sourceChainIds` and `toChainId`; other attempt records retain those route summaries.
Refreshed quotes follow the same rule and keep the attempt ID. Use `(attempt.id, quote.id)` to
count distinct quotes.

The provider is populated only when known from a quote; a failure before quoting must not invent
a provider. Source and delivery observations also use `chain.id` and `chain.role`. Step context
uses `step.id` and `step.type`. These records exclude amounts, signing data, calldata, and raw errors.
Source-status observations identify the source leg with `leg.index` and its state with `leg.status`.

Telemetry queries must use the namespaced keys below; the previous keys are no longer emitted.
The network rename also applies to registered analytics properties, `analytics.getBaseProperties()`,
and utility error logs. The client configuration option remains `network`.

| Previous key | Current key |
| --- | --- |
| `kind` | `attempt.kind` |
| `source.index` / `source.status` | `leg.index` / `leg.status` |
| `outcome.authority` | `attempt.outcome_authority` |
| `network` | `nexus.network` |
| `telemetry.schema.version` | `nexus.telemetry.schema.version` |

Available balances still return to callers on a partial response. Public balance requests emit
the partial event instead of a clean success event. Composite funding emits the same partial
observation with its attempt ID; its existing funding calculation is unchanged.

Legacy swap failure constants remain exported, but ordinary swap errors now emit the canonical
outcome or observation event. Successful operations retain their existing success events. Count
only the canonical outcome when measuring payments; do not add delivery or legacy success events.

## Catalog operation reporting

The public async catalog helpers `getTokens`, `getToken`, `getTokensByChain`,
`getAvailableSourceTokens`, `getAvailableDestinationTokens`, `confirmRouteExists`, and
`getSupportedChainsForRoute` use the same operation boundary as balances and history.
Each call emits `nexus_v2_catalog_fetch_started`, then either `nexus_v2_catalog_fetch_success`
or `nexus_v2_catalog_fetch_failed`, with `method`, `operation.id`, and client/session identity.
Failures include the bounded reason, code, category, and service when available; detailed errors
are logged to OTel with the same operation ID. The original result or error is preserved.

`nexus_v2_operation_performance` records duration in milliseconds and success, with `spanId`
matching `operation.id`. Its operation labels are `catalog_get_tokens`, `catalog_get_token`,
`catalog_get_tokens_by_chain`, `catalog_get_available_source_tokens`,
`catalog_get_available_destination_tokens`, `catalog_confirm_route_exists`, and
`catalog_get_supported_chains_for_route`.

This measures the full public call, including cache hits and local compatibility checks, rather
than individual HTTP requests. Concurrent calls have separate operation IDs even when they share
one fetch. Internal catalog lookups do not emit additional public-operation events. Empty pages
and `confirmRouteExists` returning `false` are successful results. Catalog calls do not create
payment attempts. These events contain no query text, token lists, or request amounts.

## Shared error buckets v1

`error.code` holds the shared error bucket below. `error.type` holds the original SDK error code
(for example, `backend/rate_limited`), while `error.category` and `error.service` retain the SDK
category and service. Public `NexusError.code` values and display messages keep their meanings.
`src/services/error-reporting.ts` is the executable mapping for product events and OTel logs.
Untyped errors use `error.code: unknown` without `error.type`. A confirmed expiry observation
uses `error.code: expired` without inventing an SDK error type.

`reason.bucket` is no longer emitted. Queries that used it should use `error.code`; queries for
the original SDK codes should use `error.type`.

| Bucket | Meaning |
| --- | --- |
| `user_declined` | Typed wallet/hook decline |
| `invalid_request` | Invalid input or unmet precondition |
| `unsupported_route` | Unsupported chain/token/provider combination |
| `insufficient_funds` | Missing or insufficient source balance |
| `insufficient_gas` | Source cannot fund approval gas |
| `amount_too_small` | Amount cannot cover a deposit fee or minimum gas drop |
| `quote_unavailable` | No usable quote, including `BACKEND_INTENT_REFUSED` |
| `pricing` | Price unavailable, outlier, rate drift, or slippage |
| `approval` | Insufficient allowance or sponsored approval relay failure |
| `signature` | Missing, stale, or invalid intent/permit signature |
| `simulation` | Transaction simulation failed |
| `transaction_reverted` | Chain transaction reverted |
| `expired` | Local quote expiry or confirmed intent expiry |
| `rate_limited` | Middleware throttling |
| `configuration` | Authorization, SDK initialization, environment, or provider configuration |
| `unavailable` | Other middleware or external-service failure |
| `network` | Connection failure |
| `timeout` | Request, receipt, or local fulfillment wait timeout |
| `wallet` | Other wallet interaction failure |
| `rpc` | Other blockchain read/execution failure |
| `internal` | SDK invariant failure |
| `unknown` | Untyped/unrecognized error |

Exact codes take precedence over category fallbacks. Local route and expiry errors additionally
carry an allowlisted diagnostic `details.reasonBucket` because their public codes are shared with
other errors. Arbitrary diagnostic strings and display-message matching cannot create buckets.
Product events contain only the bucket and existing bounded SDK code/category/service. Full messages,
stacks, and sanitized details remain in OTel; middleware error IDs/codes/subcodes remain searchable
there alongside the complete attempt/quote/intent IDs.

## Rollout and reconciliation

The SDK tests cover commitment, terminal outcomes, refresh identity, concurrent requests, source
deduplication, utility identity, partial balances, detailed diagnostics, and telemetry sink failure.
They establish instrumentation behavior, not production collector/dashboard delivery.

Before publishing cross-surface reliability:

1. Mirror this bucket vocabulary and schema marker into the middleware observability contract.
2. Update middleware to accept/log `x-nexus-attempt-id` and persist the attempt ID alongside
   request hash and client/surface identity. SDK records supply `session.id`; a server-side
   session transport/join is follow-up.
3. Reconcile the server's terminal status with SDK observations by attempt/request hash. Middleware
   and protocol supply outcomes after the browser closes; browser observations alone are incomplete.
4. Check for missing identities, unmatched intent hashes, duplicate/conflicting outcomes, and aged
   unresolved attempts. Deduplicate the same server status observed by several SDK polls/observers.
5. Start dashboards on the v1 changeover cohort. Record the deployment cutoff; do not compare old
   operation-error counts directly with these payment outcomes. Keep rejection escalation unset
   until its threshold is chosen from session/reason distributions.

Client IDs, sessions, attempts, versions, hashes, token addresses, and user IDs are unbounded record
attributes, never metric labels. This SDK change adds no metrics or automatic retry policy.
FastBridge/widget identity stitching, product accountability views, production reconciliation,
registry validation, and revenue/cost/margin reporting require their owning services.
