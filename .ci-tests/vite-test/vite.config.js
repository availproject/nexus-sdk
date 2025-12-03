import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/main.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => `main.${format}.js`,
    },
    rollupOptions: {
      external: [],
    },
  },
});
