import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    // The kiosk is opened from a tablet on the hall's network, never from the build machine.
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      // @menuboard/shared is a CJS workspace package resolved through a node_modules link;
      // Rollup misses some of its re-exported named bindings unless it is included here.
      include: [/shared\/dist/, /node_modules/],
    },
  },
  optimizeDeps: {
    include: ['@menuboard/shared'],
    // Vite keys its pre-bundle cache on config and lockfile, neither of which changes when
    // shared/dist is rebuilt — without this the tablet keeps running an outdated copy.
    force: true,
  },
});
