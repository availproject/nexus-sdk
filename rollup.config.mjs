import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { defineConfig } from 'rollup';
import dts from 'rollup-plugin-dts';

const shouldMinify = process.env.NODE_ENV !== 'development';
const shouldGenerateSourceMaps = false;

// Polyfill `globalThis.process` so the SDK can run in non-Node environments
// (browsers, edge runtimes) without crashing on `process.env`/`process.nextTick`.
const processPolyfillIntro =
  'if(typeof globalThis.process==="undefined"){globalThis.process={env:{},version:"",nextTick:function(cb){Promise.resolve().then(cb)},stderr:{isTTY:false},stdout:{isTTY:false},pid:0,versions:{node:""}}}';

const external = [
  /^viem/,
  'decimal.js',
  'es-toolkit',
  'posthog-js',
  'zod',
  'axios',
  '@opentelemetry/api-logs',
  '@opentelemetry/exporter-logs-otlp-http',
  '@opentelemetry/resources',
  '@opentelemetry/sdk-logs',
];

const baseConfig = {
  input: 'src/index.ts',
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
      // d.ts files are emitted by rollup-plugin-dts in a separate pass; skip here.
      declaration: false,
      declarationMap: false,
    }),
    ...(shouldMinify ? [terser()] : []),
  ],
  external,
  treeshake: {
    // Preserve side effects for external deps that rely on global proto init
    moduleSideEffects: 'no-external',
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
        intro: processPolyfillIntro,
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: shouldGenerateSourceMaps,
        exports: 'named',
        intro: processPolyfillIntro,
      },
    ],
  },
  {
    ...baseConfig,
    input: 'src/utils.ts',
    output: [
      {
        file: 'dist/utils.js',
        format: 'cjs',
        sourcemap: shouldGenerateSourceMaps,
        exports: 'named',
        interop: 'auto',
      },
      {
        file: 'dist/utils.esm.js',
        format: 'esm',
        sourcemap: shouldGenerateSourceMaps,
        exports: 'named',
      },
    ],
  },

  // TypeScript declarations
  {
    input: 'src/index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    plugins: [dts()],
    external,
  },
  {
    input: 'src/utils.ts',
    output: [{ file: 'dist/utils.d.ts', format: 'esm' }],
    plugins: [dts()],
    external,
  },
]);
