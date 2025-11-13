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

// Base configuration
const baseConfig = {
  input: 'index.ts',
  plugins: [
    json(),
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs({
      include: /node_modules/,
    }),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: shouldGenerateSourceMaps,
    }),
  ],
  external: [...Object.keys(packageJson.dependencies || {}).filter((p) => p !== 'buffer'), /^viem/],
  treeshake: {
    moduleSideEffects(id, external) {
      // Always preserve side effects from _polyfill files
      if (id && /_polyfill\.(ts|js)$/.test(id)) {
        return true;
      }
      // Preserve side effects for external modules
      return external;
    },
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
    external: [...Object.keys(packageJson.dependencies || {}), /^viem/],
  },
]);
