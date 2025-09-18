import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import json from '@rollup/plugin-json';
import alias from '@rollup/plugin-alias';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('./package.json');

const isProduction = process.env.NODE_ENV === 'production';
const shouldGenerateSourceMaps = false;

// Base configuration for core (no React, no CSS)
const baseConfig = {
  input: 'index.ts',
  plugins: [
    alias({
      // Alias is not used for externals but kept for future non-externalized builds
      entries: [{ find: '@nexus/commons', replacement: './commons' }],
    }),
    json(),
    resolve({
      browser: true,
      preferBuiltins: false,
      exportConditions: ['browser', 'module', 'import'],
    }),
    commonjs({
      include: /node_modules/,
      transformMixedEsModules: true,
      ignoreTryCatch: false,
    }),
    typescript({
      tsconfig: './tsconfig.json',
      useTsconfigDeclarationDir: true,
    }),
  ],
  external: [
    // Peer dependencies that consumers should install
    ...Object.keys(packageJson.peerDependencies || {}),
    /^viem/,
    // External dependencies that consumers should install
    '@arcana/ca-common',
    '@cosmjs/proto-signing',
    '@cosmjs/stargate',
    '@starkware-industries/starkware-crypto-utils',
    '@metamask/safe-event-emitter',
    '@nexus/commons',
    'decimal.js',
    'fuels',
    'long',
    'msgpackr',
    'tslib',
    'it-ws',
    './commons',
  ],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

export default defineConfig([
  // Build configurations
  {
    ...baseConfig,
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        sourcemap: shouldGenerateSourceMaps,
        exports: 'named',
        interop: 'auto',
        paths: {
          '@nexus/commons': './commons',
          '@nexus/commons/constants': './commons/constants',
        },
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: shouldGenerateSourceMaps,
        exports: 'named',
        paths: {
          '@nexus/commons': './commons',
          '@nexus/commons/constants': './commons/constants',
        },
      },
    ],
  },

  // TypeScript declarations
  {
    input: 'index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    plugins: [
      dts(),
      // Rewrite import specifiers in generated d.ts
      {
        name: 'rewrite-commons-imports-dts',
        renderChunk(code) {
          return code
            .replace(/@nexus\/commons\/constants/g, './commons/constants')
            .replace(/@nexus\/commons/g, './commons');
        },
      },
    ],
    external: [
      ...Object.keys(packageJson.peerDependencies || {}),
      /^viem/,
      /^@arcana/,
      /^@cosmjs/,
      /^@starkware-industries/,
      '@metamask/safe-event-emitter',
      'decimal.js',
      'fuels',
      'long',
      'msgpackr',
      'tslib',
      'it-ws',
      '@nexus/commons',
      './commons',
    ],
  },
]);
