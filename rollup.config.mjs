import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import dts from 'rollup-plugin-dts';
import postcss from 'rollup-plugin-postcss';
import { defineConfig } from 'rollup';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('./package.json');

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// Entry points configuration
const entries = [
  { input: 'src/core.ts', name: 'core' },
  { input: 'src/ui.ts', name: 'ui' }
];

// Base configuration factory
const createBaseConfig = (entry, withCSS = false) => ({
  input: entry.input,
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
    // PostCSS plugin only for UI build
    ...(withCSS ? [postcss({
      inject: true,
      extract: false,
      minimize: isProduction,
      sourceMap: !isProduction,
      modules: false,
      config: {
        path: './postcss.config.js',
      },
    })] : []),
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
    unknownGlobalSideEffects: false,
    tryCatchDeoptimization: false,
  }
});

// Output configurations factory
const createOutputs = (name) => [
  {
    file: `dist/${name}.js`,
    format: 'cjs',
    sourcemap: !isProduction,
    exports: 'named',
    interop: 'auto',
    inlineDynamicImports: true,
    ...(isDevelopment && {
      banner: `/* Avail Nexus SDK ${name} - Development Build */`
    })
  },
  {
    file: `dist/${name}.esm.js`,
    format: 'esm',
    sourcemap: !isProduction,
    exports: 'named',
    inlineDynamicImports: true,
    ...(isDevelopment && {
      banner: `/* Avail Nexus SDK ${name} - Development Build */`
    })
  },
];

export default defineConfig([
  // Build configurations for each entry point
  ...entries.flatMap(entry => [
    {
      ...createBaseConfig(entry, entry.name === 'ui'),
      output: createOutputs(entry.name),
    }
  ]),
  
  // TypeScript declarations for each entry point
  ...entries.map(entry => ({
    input: entry.input,
    output: [{ file: `dist/${entry.name}.d.ts`, format: 'esm' }],
    plugins: [dts({
      exclude: ['**/*.css']
    })],
    external: [...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.peerDependencies || {}), /\.css$/],
  }))
]); 