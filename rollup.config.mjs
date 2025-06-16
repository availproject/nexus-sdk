import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { defineConfig } from 'rollup';
import { createRequire } from 'module';
import nodePolyfills from 'rollup-plugin-polyfill-node';

const require = createRequire(import.meta.url);
const packageJson = require('./package.json');

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// Base configuration
const baseConfig = {
  input: 'src/index.ts',
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events', 'crypto'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    resolve({
      browser: true,
      preferBuiltins: false,
      exportConditions: ['browser']
    }),
    commonjs({
      include: /node_modules/,
      transformMixedEsModules: true
    }),
    typescript({ 
      tsconfig: './tsconfig.json',
      // Add development-specific options
      ...(isDevelopment && {
        sourceMap: true,
        inlineSources: true
      })
    }),
  ],
  external: [...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.peerDependencies || {})],
};

// Output configurations
const outputs = [
  {
    file: packageJson.main,
    format: 'cjs',
    sourcemap: !isProduction,
    exports: 'named',
    // Add banner for development builds
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
  },
]); 