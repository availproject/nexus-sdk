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
const isDevelopment = process.env.NODE_ENV === 'development';

// Base configuration
const baseConfig = {
  input: 'src/index.ts',
  plugins: [
    json(),
    resolve({
      browser: true,
      preferBuiltins: false,
      exportConditions: ['browser', 'module', 'import'],
      dedupe: ['react', 'react-dom'],
    }),
    commonjs({
      include: /node_modules/,
      transformMixedEsModules: true,
      ignoreTryCatch: false,
    }),
    typescript({ 
      tsconfig: './tsconfig.json',
      ...(isDevelopment && {
        sourceMap: true,
        inlineSources: true
      })
    }),
  ],
  external: [...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.peerDependencies || {})],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  }
};

// Output configurations
const outputs = [
  {
    file: packageJson.main,
    format: 'cjs',
    sourcemap: !isProduction,
    exports: 'named',
    interop: 'auto',
    ...(isDevelopment && {
      banner: '/* Avail Nexus SDK - Development Build */'
    })
  },
  {
    file: packageJson.module,
    format: 'esm',
    sourcemap: !isProduction,
    exports: 'named',
    ...(isDevelopment && {
      banner: '/* Avail Nexus SDK - Development Build */'
    })
  },
];

export default defineConfig([
  {
    ...baseConfig,
    output: outputs,
  },
  {
    input: 'src/index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    plugins: [dts()],
    external: [...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.peerDependencies || {})],
  },
]); 