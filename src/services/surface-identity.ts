import { version } from '../../package.json' with { type: 'json' };

export type SurfaceIdentity = {
  surfaceName: string;
  surfaceVersion: string;
};

export const resolveSurfaceIdentity = (options?: Partial<SurfaceIdentity>): SurfaceIdentity => ({
  surfaceName: options?.surfaceName ?? 'nexus-sdk',
  surfaceVersion: options?.surfaceVersion ?? version,
});
