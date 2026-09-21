# SDK payment reporting contract

This implements the SDK portion of `ai-error-1.md`. `ai-error-2.md` describes older implementations;
its bridge-specific event names and timeout paths do not apply to the current intent runtime.

## Identity and correlation

Every client event and operation error log carries `nexus.client.id`, `surface.name: nexus-sdk`,
`surface.version`, `session.id`, and `network`. Client identity is the configured value, not a
generated browser ID or hostname. The shared OTel resource retains the SDK service identity and
package version; client/session/network attribution belongs on each record.

The SDK sends `x-nexus-client-id`, `x-nexus-surface`, and `x-nexus-surface-version` on intent HTTP
requests. Standalone `getSupportedChains(network, { clientId })` takes explicit identity;
`client.utils.getSupportedChains(network)` uses its client configuration. Stateless utilities
have no SDK session to attach. Their diagnostic logs remain separate from client operation logs.

Each public swap call creates one `attempt.id`, reusing the operation's ID. It exists before local
validation and the first quote. All quote refreshes, submit, status/detail polling, and composite
funding requests send it in middleware's existing `x-request-id` header. IDs are supplied per
request, so concurrent operations cannot overwrite one another. A new call gets a new ID.
Optional network timing spans use the attempt as their parent operation.

`quote.id` links each accepted quote, `intent.id` links the committed intent, and transaction
observations preserve complete `transaction.hash` values. These fields, and `operation.id`, are
join keys on records, never metric labels. No identity/correlation field is added to signed RFFs,
signature envelopes, or protocol transaction payloads. Hooks and successful results expose
`attemptId` for support correlation.

## Outcomes and authority

All attempt events carry `telemetry.schema.version: 1`. **Only
`nexus_v2_intent_outcome` is a terminal outcome event.** It includes `attempt.outcome`,
`attempt.committed`, `attempt.pending`, `attempt.duration_ms`, and `outcome.authority`.

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
| `intent_quoted` | Initial or refreshed executable quote accepted |
| `intent_quote_refresh_failed` | Refresh failed; the hook may recover within this attempt |
| `intent_committed` | First commitment point reached |
| `intent_transaction` | Approval/source transaction broadcast, including its hash |
| `intent_source_status` | A source status or transaction hash changed |
| `intent_delivered` | Destination fulfillment observed |
| `intent_outcome` | One terminal payment outcome |
| `intent_observation_failed` | SDK lost progress after commitment; terminal outcome unknown |
| `intent_skipped` | Composite operation needed no swap |
| `balances_fetch_partial` | Middleware returned available balances with `errored: true` |

Quote observations carry `provider.name`, deduplicated `sourceChainIds`, paired
`sources: [{ chainId, tokenAddress }]`, `toChainId`, and `toTokenAddress`. The provider is populated
only when known from a quote; a failure before quoting must not invent a provider. Source and
delivery observations add `chain.id` and `chain.role: source | destination`. Step context uses
`step.id` and `step.type`. These records exclude amounts, signing data, calldata, and raw errors.

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

## Internal reason buckets v1

`reason.bucket` is an internal reporting vocabulary. `error.code`, `error.category`, and
`error.service` remain the existing SDK values. Public error objects and display messages keep
their meanings. `src/services/error-reporting.ts` is the executable mapping.

| Bucket | Meaning |
| --- | --- |
| `user_declined` | Typed wallet/hook decline |
| `invalid_request` | Invalid input or unmet precondition |
| `unsupported_route` | Unsupported chain/token/provider combination |
| `insufficient_funds` | Missing or insufficient source balance |
| `insufficient_gas` | Source cannot fund approval gas |
| `amount_too_small` | Amount cannot cover a deposit fee or minimum gas drop |
| `quote_unavailable` | No usable quote |
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
Product events contain only the bucket and existing bounded code/category/service. Full messages,
stacks, and sanitized details remain in OTel; middleware error IDs/codes/subcodes remain searchable
there alongside the complete attempt/quote/intent IDs.

## Rollout and reconciliation

The SDK tests cover commitment, terminal outcomes, refresh identity, concurrent requests, source
deduplication, utility identity, partial balances, detailed diagnostics, and telemetry sink failure.
They establish instrumentation behavior, not production collector/dashboard delivery.

Before publishing cross-surface reliability:

1. Mirror this bucket vocabulary and schema marker into the middleware observability contract.
2. Persist the request ID as the attempt join alongside request hash and client/surface identity.
   Middleware currently accepts/logs `x-request-id`; it does not yet persist the full attempt/session
   relationship. SDK records supply `session.id`; a server-side session transport/join is follow-up.
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
