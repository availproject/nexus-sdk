import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
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
      sourceMap: shouldGenerateSourceMaps,
    }),
  ],
  external: [
    // Peer dependencies that consumers should install
    ...Object.keys(packageJson.peerDependencies || {}),
    /^viem/,
    // External dependencies that consumers should install
    '@arcana/ca-sdk',
    '@metamask/safe-event-emitter',
    'decimal.js',
    // @nexus/commons will be bundled since it's not published
  ],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  }
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
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: shouldGenerateSourceMaps,
        exports: 'named',
      },
    ],
  },
  
  // TypeScript declarations
  {
    input: 'index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    plugins: [dts()],
    external: [...Object.keys(packageJson.peerDependencies || {}), /^viem/, /^@arcana/, '@metamask/safe-event-emitter', 'decimal.js'],
  }
]);