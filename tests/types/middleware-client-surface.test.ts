import type { MiddlewareClient } from '../../src/transport';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

const assertions: [Assert<IsEqual<IsOptional<MiddlewareClient, 'getRFFStatus'>, false>>] = [true];
void assertions;

declare const middlewareClient: MiddlewareClient;
middlewareClient.getRFFStatus satisfies MiddlewareClient['getRFFStatus'];
