import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: true,
  external: ['crypto', 'fs', 'path', 'stream', 'http', 'https', 'net', 'tls', 'zlib', 'os'],
  define: {
    global: 'globalThis',
  },
  inject: [],
});

console.log('✅ esbuild bundle completed successfully');
