import type { OnAllowanceHook, OnIntentHook } from '../../domain';

export const resolveHooks = (options?: {
  hooks?: { onAllowance?: OnAllowanceHook; onIntent?: OnIntentHook };
}) => ({
  onAllowance:
    options?.hooks?.onAllowance ??
    ((data: { allow: (selections: Array<'max' | 'min'>) => void; sources: unknown[] }) =>
      data.allow(data.sources.map(() => 'min'))),
  onIntent: options?.hooks?.onIntent ?? ((data: { allow: () => void }) => data.allow()),
});
