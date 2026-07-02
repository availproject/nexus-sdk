import type {
  BridgeAndExecuteEvent,
  BridgeEvent,
  NexusClient,
  SwapAndExecuteEvent,
  SwapEvent,
} from '../../src';

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type EventOf<T> = T extends { onEvent?: ((event: infer TEvent) => void) | undefined } ? TEvent : never;

type BridgeOptions = NonNullable<Parameters<NexusClient['bridge']>[1]>;
type BridgeAndExecuteOptions = NonNullable<Parameters<NexusClient['bridgeAndExecute']>[1]>;
type SwapOptions = NonNullable<Parameters<NexusClient['swapWithExactOut']>[1]>;
type SwapAndExecuteOptions = NonNullable<Parameters<NexusClient['swapAndExecute']>[1]>;

type BridgeSdkEvent = EventOf<BridgeOptions>;
type BridgeAndExecuteSdkEvent = EventOf<BridgeAndExecuteOptions>;
type SwapSdkEvent = EventOf<SwapOptions>;
type SwapAndExecuteSdkEvent = EventOf<SwapAndExecuteOptions>;

const assertions: [
  Assert<IsEqual<BridgeSdkEvent, BridgeEvent>>,
  Assert<IsEqual<BridgeAndExecuteSdkEvent, BridgeAndExecuteEvent>>,
  Assert<IsEqual<SwapSdkEvent, SwapEvent>>,
  Assert<IsEqual<SwapAndExecuteSdkEvent, SwapAndExecuteEvent>>,
  Assert<IsNever<Extract<BridgeSdkEvent, { name: string }>>>,
  Assert<IsNever<Extract<BridgeAndExecuteSdkEvent, { name: string }>>>,
  Assert<IsNever<Extract<SwapSdkEvent, { name: string }>>>,
  Assert<IsNever<Extract<SwapAndExecuteSdkEvent, { name: string }>>>,
] = [true, true, true, true, true, true, true, true];
void assertions;

declare const bridgeEvent: BridgeSdkEvent;
declare const bridgeAndExecuteEvent: BridgeAndExecuteSdkEvent;
declare const swapEvent: SwapSdkEvent;
declare const swapAndExecuteEvent: SwapAndExecuteSdkEvent;

if (bridgeEvent.type === 'status') {
  bridgeEvent.status satisfies Extract<BridgeEvent, { type: 'status' }>['status'];
}

if (bridgeAndExecuteEvent.type === 'plan_progress' && bridgeAndExecuteEvent.stepType === 'execute_transaction') {
  bridgeAndExecuteEvent.step.type satisfies 'execute_transaction';
}

if (swapEvent.type === 'plan_progress' && swapEvent.stepType === 'bridge_fill') {
  swapEvent.intentRequestHash satisfies `0x${string}`;
}

if (swapAndExecuteEvent.type === 'plan_progress' && swapAndExecuteEvent.stepType === 'execute_transaction') {
  swapAndExecuteEvent.value satisfies string;
}

// @ts-expect-error bridge events must not accept legacy swap payloads
const invalidBridgeEvent: BridgeSdkEvent = { name: 'SWAP_STEP_COMPLETE', args: {} };
void invalidBridgeEvent;

// @ts-expect-error swap events must not accept legacy bridge payloads
const invalidSwapEvent: SwapSdkEvent = { name: 'STEP_COMPLETE', args: {} };
void invalidSwapEvent;
