/**
 * Type-level drift assertion for the per-category `service` mapping. Direct subclass
 * constructor calls must accept exactly the service literals allowed by `ServiceFor<C>`,
 * and reject everything else. Consumed by `npm run typecheck:tests`.
 *
 * Each `@ts-expect-error` annotation requires the next statement to be a type error;
 * if a future change widens or narrows a service union incorrectly, the file fails to
 * compile in both directions (too-permissive AND over-narrow).
 */

import {
  BackendError,
  ERROR_CODES,
  ExecutionError,
  ExternalServiceError,
  InternalError,
  SimulationError,
  UserActionError,
  ValidationError,
} from '../../src/domain/errors';

// ── BackendError: service must be 'middleware'
new BackendError(ERROR_CODES.BACKEND_ERROR, 'm', { context: { service: 'middleware' } });
// @ts-expect-error — 'wallet' is not assignable to 'middleware'
new BackendError(ERROR_CODES.BACKEND_ERROR, 'm', { context: { service: 'wallet' } });
// @ts-expect-error — 'rpc' is not assignable to 'middleware'
new BackendError(ERROR_CODES.BACKEND_ERROR, 'm', { context: { service: 'rpc' } });
// @ts-expect-error — service is required for backend
new BackendError(ERROR_CODES.BACKEND_ERROR, 'm', { context: {} });

// ── ExecutionError: service must be 'wallet' | 'rpc'
new ExecutionError(ERROR_CODES.EXECUTION_ERROR, 'm', { context: { service: 'wallet' } });
new ExecutionError(ERROR_CODES.EXECUTION_ERROR, 'm', { context: { service: 'rpc' } });
// @ts-expect-error — 'middleware' not in execution's union
new ExecutionError(ERROR_CODES.EXECUTION_ERROR, 'm', { context: { service: 'middleware' } });
// @ts-expect-error — 'coinbase' not in execution's union
new ExecutionError(ERROR_CODES.EXECUTION_ERROR, 'm', { context: { service: 'coinbase' } });

// ── ExternalServiceError: service must be 'lifi' | 'bebop' | 'coinbase'
new ExternalServiceError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'm', { context: { service: 'lifi' } });
new ExternalServiceError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'm', { context: { service: 'bebop' } });
new ExternalServiceError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'm', { context: { service: 'coinbase' } });
// @ts-expect-error — 'middleware' not in external_service's union
new ExternalServiceError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'm', { context: { service: 'middleware' } });

// ── UserActionError: service must be 'wallet' | 'hook'
new UserActionError(ERROR_CODES.USER_ACTION_ERROR, 'm', { context: { service: 'hook' } });
new UserActionError(ERROR_CODES.USER_ACTION_ERROR, 'm', { context: { service: 'wallet' } });
// @ts-expect-error — 'rpc' not in user_action's union
new UserActionError(ERROR_CODES.USER_ACTION_ERROR, 'm', { context: { service: 'rpc' } });

// ── SimulationError: service must be 'rpc'
new SimulationError(ERROR_CODES.SIMULATION_ERROR, 'm', { context: { service: 'rpc' } });
// @ts-expect-error — 'wallet' not in simulation's union
new SimulationError(ERROR_CODES.SIMULATION_ERROR, 'm', { context: { service: 'wallet' } });

// ── ValidationError / InternalError: no service field accepted
new ValidationError(ERROR_CODES.VALIDATION_ERROR, 'm', { context: { operation: 'bridge' } });
new InternalError(ERROR_CODES.INTERNAL_ERROR, 'm', { context: {} });
// @ts-expect-error — service field rejected for validation
new ValidationError(ERROR_CODES.VALIDATION_ERROR, 'm', { context: { service: 'wallet' } });
// @ts-expect-error — service field rejected for internal
new InternalError(ERROR_CODES.INTERNAL_ERROR, 'm', { context: { service: 'rpc' } });
