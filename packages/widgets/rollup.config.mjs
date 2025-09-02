import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import json from '@rollup/plugin-json';
import alias from '@rollup/plugin-alias';
import dts from 'rollup-plugin-dts';
import postcss from 'rollup-plugin-postcss';
import { defineConfig } from 'rollup';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const packageJson = require('./package.json');

const isProduction = process.env.NODE_ENV === 'production';
const shouldGenerateSourceMaps = false;

// Base configuration for widgets (includes React, CSS)
const baseConfig = {
  input: 'src/index.ts',
  plugins: [
    alias({
      entries: [{ find: '@nexus/commons', replacement: '../commons/dist/index.esm.js' }],
    }),
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
    // PostCSS plugin for CSS processing
    postcss({
      inject: true,
      extract: false,
      minimize: isProduction,
      sourceMap: shouldGenerateSourceMaps,
      modules: false,
      config: {
        path: './postcss.config.js',
      },
    }),
    typescript({
      tsconfig: './tsconfig.json',
      useTsconfigDeclarationDir: true,
    }),
  ],
  external: [
    // Peer dependencies that consumers should install
    ...Object.keys(packageJson.peerDependencies || {}),
    /^react/,
    /^react-dom/,
    /^viem/,
    // External dependencies that consumers should install
    '@lottiefiles/dotlottie-react',
    /^motion/,
    'decimal.js',
    '@nexus/core',
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
        inlineDynamicImports: true,
        paths: {
          '@nexus/core': '@avail-project/nexus',
        },
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: shouldGenerateSourceMaps,
        exports: 'named',
        inlineDynamicImports: true,
        paths: {
          '@nexus/core': '@avail-project/nexus',
        },
      },
    ],
  },

  // TypeScript declarations
  {
    input: 'src/index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: false,
      }),
      dts({ exclude: ['**/*.css'] }),
      // Rewrite import specifiers in generated d.ts
      {
        name: 'rewrite-commons-and-core-imports-dts',
        renderChunk(code) {
          return code
            .replace(/@nexus\/commons\/constants/g, './commons/constants')
            .replace(/@nexus\/commons/g, './commons')
            .replace(/@nexus\/core/g, '@avail-project/nexus');
        },
      },
    ],
    external: [
      ...Object.keys(packageJson.peerDependencies || {}),
      /^react/,
      /^viem/,
      '@lottiefiles/dotlottie-react',
      /^motion/,
      'decimal.js',
      '@nexus/core',
      /\.css$/,
    ],
  },
]);
