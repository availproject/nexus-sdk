import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import json from '@rollup/plugin-json';
import alias from '@rollup/plugin-alias';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';
import { createRequire } from 'node:module';
import inject from '@rollup/plugin-inject';
const require = createRequire(import.meta.url);
const packageJson = require('./package.json');

const isProduction = process.env.NODE_ENV === 'production';
const shouldGenerateSourceMaps = false;

// Base configuration for core (no React, no CSS)
const baseConfig = {
  input: 'index.ts',
  // Prelude to ensure globals and alias methods exist before any bundled modules run
  banner: `
import { Buffer as __NEXUS_BUFFER__ } from 'buffer';
import __NEXUS_PROCESS__ from 'process';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = __NEXUS_BUFFER__;
if (typeof globalThis.process === 'undefined') globalThis.process = __NEXUS_PROCESS__;
if (typeof globalThis.global === 'undefined') globalThis.global = globalThis;
const __B__ = globalThis.Buffer;
if (__B__) {
  // Alias Node 20+ style Uint methods to Node classic UInt methods for buffer@6
  if (!__B__.prototype.writeUint8 && __B__.prototype.writeUInt8) __B__.prototype.writeUint8 = __B__.prototype.writeUInt8;
  if (!__B__.prototype.readUint8 && __B__.prototype.readUInt8) __B__.prototype.readUint8 = __B__.prototype.readUInt8;
  if (!__B__.prototype.writeUint16BE && __B__.prototype.writeUInt16BE) __B__.prototype.writeUint16BE = __B__.prototype.writeUInt16BE;
  if (!__B__.prototype.writeUint16LE && __B__.prototype.writeUInt16LE) __B__.prototype.writeUint16LE = __B__.prototype.writeUInt16LE;
  if (!__B__.prototype.readUint16BE && __B__.prototype.readUInt16BE) __B__.prototype.readUint16BE = __B__.prototype.readUInt16BE;
  if (!__B__.prototype.readUint16LE && __B__.prototype.readUInt16LE) __B__.prototype.readUint16LE = __B__.prototype.readUInt16LE;
  if (!__B__.prototype.writeUint32BE && __B__.prototype.writeUInt32BE) __B__.prototype.writeUint32BE = __B__.prototype.writeUInt32BE;
  if (!__B__.prototype.writeUint32LE && __B__.prototype.writeUInt32LE) __B__.prototype.writeUint32LE = __B__.prototype.writeUInt32LE;
  if (!__B__.prototype.readUint32BE && __B__.prototype.readUInt32BE) __B__.prototype.readUint32BE = __B__.prototype.readUInt32BE;
  if (!__B__.prototype.readUint32LE && __B__.prototype.readUInt32LE) __B__.prototype.readUint32LE = __B__.prototype.readUInt32LE;
}
`.trim(),
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
    inject({
      Buffer: ['buffer', 'Buffer'],
      process: 'process',
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
    '@tronweb3/tronwallet-abstract-adapter',
    // Ensure TronWeb is not bundled to preserve its side-effectful proto setup
    'tronweb',
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
    'axios',
    'es-toolkit',
    './commons',
  ],
  treeshake: {
    // Preserve side effects for external deps like tronweb that rely on global proto init
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
        banner: baseConfig.banner,
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
        banner: baseConfig.banner,
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
      '@tronweb3/tronwallet-abstract-adapter',
      'tronweb',
      'decimal.js',
      'fuels',
      'long',
      'msgpackr',
      'tslib',
      '@nexus/commons',
      'axios',
      'es-toolkit',
      './commons',
    ],
  },
]);
