import { NexusAnalyticsEvents as Events, type NexusAnalyticsEvent } from '../analytics/events';
import { NexusError } from '../domain/errors';
import { getErrorReportingProperties } from '../services/error-reporting';
import type { IntentEvent, IntentQuote, IntentTransaction } from './types';

type Outcome = 'completed' | 'stopped' | 'rejected' | 'failed';

/** One instance per public swap call, including every quote refresh and source leg. */
export const createIntentReporting = (
  attemptId: string,
  initialProperties: Record<string, unknown>,
  emit: (event: NexusAnalyticsEvent, properties: Record<string, unknown>) => void
) => {
  const startedAt = Date.now();
  let committed = false;
  let outcome: Outcome | undefined;
  let skipped = false;
  let quote: IntentQuote | undefined;
  let reason: Record<string, string> = {};
  const route = { ...initialProperties };
  const legs = new Map<number, string>();
  const properties = (): Record<string, unknown> => ({
    ...route,
    'telemetry.schema.version': 1,
    'attempt.id': attemptId,
    'attempt.committed': committed,
    'attempt.pending': committed && !outcome,
    ...(outcome ? { 'attempt.outcome': outcome } : {}),
    ...(skipped ? { 'attempt.skipped': true } : {}),
    ...reason,
  });
  const report = (event: NexusAnalyticsEvent, extra?: Record<string, unknown>) => {
    try {
      let eventProperties = { ...properties(), ...extra };
      if (event === Events.INTENT_QUOTED) {
        const {
          sourceChainIds: _sources,
          toChainId: _destination,
          ...chainProperties
        } = eventProperties;
        eventProperties = chainProperties;
      }
      emit(event, eventProperties);
    } catch {
      // An observer cannot change wallet or intent execution.
    }
  };
  const terminal = (value: Outcome) => {
    if (outcome || skipped) return;
    outcome = value;
    report(Events.INTENT_OUTCOME, {
      'attempt.duration_ms': Date.now() - startedAt,
      'outcome.authority': value === 'completed' || value === 'failed' ? 'middleware' : 'sdk',
    });
  };
  const commit = () => {
    if (committed) return;
    committed = true;
    if (quote) route['intent.id'] = quote.id;
    report(Events.INTENT_COMMITTED);
  };

  report(Events.INTENT_STARTED);
  return {
    attemptId,
    properties,
    commit,
    observe(event: IntentEvent) {
      if (outcome || skipped) return;
      if (event.type === 'quote') {
        quote = event.quote;
        const sourceChainIds = [...new Set(quote.input.map((source) => source.chainId))];
        Object.assign(route, {
          'quote.id': quote.id,
          'provider.name': quote.provider,
          sourceChainIds,
          sources: quote.input.map((source) => ({
            chainId: source.chainId,
            tokenAddress: source.tokenAddress,
          })),
          toChainId: quote.output.chainId,
          toTokenAddress: quote.output.tokenAddress,
        });
        for (const chainId of sourceChainIds) {
          report(Events.INTENT_QUOTED, { 'chain.id': chainId, 'chain.role': 'source' });
        }
        report(Events.INTENT_QUOTED, {
          'chain.id': quote.output.chainId,
          'chain.role': 'destination',
        });
      } else if (event.type === 'step') {
        if (event.committed) commit();
        route['step.type'] = event.step.type;
        route['step.id'] = event.step.id;
      } else {
        route['intent.id'] = event.intentId;
        for (const leg of event.legs) {
          const key = `${leg.status}:${leg.txHash ?? ''}`;
          if (legs.get(leg.sourceIndex) === key) continue;
          legs.set(leg.sourceIndex, key);
          report(Events.INTENT_SOURCE_STATUS, {
            'chain.role': 'source',
            'chain.id': quote?.input[leg.sourceIndex]?.chainId,
            'source.index': leg.sourceIndex,
            'source.status': leg.status,
            ...(leg.txHash ? { 'transaction.hash': leg.txHash } : {}),
          });
        }
        if (event.status === 'fulfilled' && !outcome) {
          terminal('completed');
          report(Events.INTENT_DELIVERED, {
            'chain.id': quote?.output.chainId,
            'chain.role': 'destination',
          });
        } else if (event.status === 'expired' && !outcome) {
          reason = { 'error.code': 'expired' };
          terminal('failed');
        }
      }
    },
    transaction(
      kind: 'approval' | 'source',
      transaction: Pick<IntentTransaction, 'chainId' | 'txHash'>
    ) {
      report(Events.INTENT_TRANSACTION, {
        'transaction.kind': kind,
        'chain.role': 'source',
        'chain.id': transaction.chainId,
        'transaction.hash': transaction.txHash,
      });
    },
    refreshFailed(error: unknown) {
      report(Events.INTENT_QUOTE_REFRESH_FAILED, getErrorReportingProperties(error));
    },
    skip() {
      skipped = true;
      report(Events.INTENT_SKIPPED);
    },
    failed(error: unknown) {
      if (outcome || skipped) return;
      reason = getErrorReportingProperties(error);
      if (committed) {
        // The browser cannot determine delivery after losing contact with the server.
        report(Events.INTENT_OBSERVATION_FAILED, { 'error.retryability': 'check_status' });
      } else {
        terminal(
          error instanceof NexusError && error.category === 'user_action' ? 'stopped' : 'rejected'
        );
      }
    },
  };
};

export type IntentReporting = ReturnType<typeof createIntentReporting>;
