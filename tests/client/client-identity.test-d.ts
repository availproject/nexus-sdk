import { expectTypeOf } from 'vitest';
import type { createBase } from '../../src/client/base';
import type { createNexusClient } from '../../src/client/create-client';
import type { createNexusUtils, getSupportedChains } from '../../src/client/utils';
import type { createMiddlewareClient } from '../../src/intent/middleware';

type Identity = {
  clientId: string;
  surfaceName: string;
  surfaceVersion: string;
};

expectTypeOf<Parameters<typeof createBase>[0]>().toExtend<Identity>();
expectTypeOf<Parameters<typeof createMiddlewareClient>[1]>().toExtend<Identity>();
expectTypeOf<Parameters<typeof createNexusUtils>[0]>().toExtend<Identity>();

expectTypeOf<{ clientId: string }>().toExtend<Parameters<typeof createNexusClient>[0]>();
expectTypeOf<{ clientId: string }>()
  .toExtend<NonNullable<Parameters<typeof getSupportedChains>[1]>>();
