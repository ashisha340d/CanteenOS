import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Mirrors the `@/*` -> `src/*` path mapping in tsconfig.json so shadcn/ui's generated
    // imports resolve at build time as well as in the type checker.
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      // @menuboard/shared is a CJS workspace package pulled in via a node_modules link,
      // not published node_modules; Rollup's default commonjs handling misses some of its
      // re-exported named exports (e.g. HEADERS) unless explicitly included here.
      include: [/shared\/dist/, /node_modules/],
    },
    rollupOptions: {
      output: {
        // Vendor code changes far less often than app code and is shared across every
        // route regardless of the page-level code-splitting in src/routes.tsx, so it is
        // split into its own long-lived cacheable chunks rather than left in the one
        // "everything else" bundle.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['radix-ui', 'lucide-react', 'cmdk', 'sonner', 'vaul', 'react-resizable-panels'],
          'vendor-table': ['ag-grid-community', 'ag-grid-react'],
          'vendor-query': ['@tanstack/react-query', 'axios'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['@menuboard/shared'],
    // @menuboard/shared is a linked workspace package: Vite keys its pre-bundle cache on
    // config and lockfile, neither of which changes when shared/dist is rebuilt, so the
    // browser would keep running an outdated copy (missing enum members read as undefined).
    force: true,
  },
});
