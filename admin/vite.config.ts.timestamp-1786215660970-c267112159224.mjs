// vite.config.ts
import path from "node:path";
import { defineConfig } from "file:///E:/MenuBoard/node_modules/vite/dist/node/index.js";
import react from "file:///E:/MenuBoard/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///E:/MenuBoard/node_modules/@tailwindcss/vite/dist/index.mjs";
var __vite_injected_original_dirname = "E:\\MenuBoard\\admin";
var vite_config_default = defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Mirrors the `@/*` -> `src/*` path mapping in tsconfig.json so shadcn/ui's generated
    // imports resolve at build time as well as in the type checker.
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    commonjsOptions: {
      // @menuboard/shared is a CJS workspace package pulled in via a node_modules link,
      // not published node_modules; Rollup's default commonjs handling misses some of its
      // re-exported named exports (e.g. HEADERS) unless explicitly included here.
      include: [/shared\/dist/, /node_modules/]
    },
    rollupOptions: {
      output: {
        // Vendor code changes far less often than app code and is shared across every
        // route regardless of the page-level code-splitting in src/routes.tsx, so it is
        // split into its own long-lived cacheable chunks rather than left in the one
        // "everything else" bundle.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-ui": ["radix-ui", "lucide-react", "cmdk", "sonner", "vaul", "react-resizable-panels"],
          "vendor-table": ["@tanstack/react-table"],
          "vendor-query": ["@tanstack/react-query", "axios"],
          "vendor-forms": ["react-hook-form", "@hookform/resolvers", "zod"]
        }
      }
    }
  },
  optimizeDeps: {
    include: ["@menuboard/shared"],
    // @menuboard/shared is a linked workspace package: Vite keys its pre-bundle cache on
    // config and lockfile, neither of which changes when shared/dist is rebuilt, so the
    // browser would keep running an outdated copy (missing enum members read as undefined).
    force: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxNZW51Qm9hcmRcXFxcYWRtaW5cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkU6XFxcXE1lbnVCb2FyZFxcXFxhZG1pblxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRTovTWVudUJvYXJkL2FkbWluL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tICdAdGFpbHdpbmRjc3Mvdml0ZSc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpLCB0YWlsd2luZGNzcygpXSxcbiAgcmVzb2x2ZToge1xuICAgIC8vIE1pcnJvcnMgdGhlIGBALypgIC0+IGBzcmMvKmAgcGF0aCBtYXBwaW5nIGluIHRzY29uZmlnLmpzb24gc28gc2hhZGNuL3VpJ3MgZ2VuZXJhdGVkXG4gICAgLy8gaW1wb3J0cyByZXNvbHZlIGF0IGJ1aWxkIHRpbWUgYXMgd2VsbCBhcyBpbiB0aGUgdHlwZSBjaGVja2VyLlxuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgc3RyaWN0UG9ydDogdHJ1ZSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6ICdkaXN0JyxcbiAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgY29tbW9uanNPcHRpb25zOiB7XG4gICAgICAvLyBAbWVudWJvYXJkL3NoYXJlZCBpcyBhIENKUyB3b3Jrc3BhY2UgcGFja2FnZSBwdWxsZWQgaW4gdmlhIGEgbm9kZV9tb2R1bGVzIGxpbmssXG4gICAgICAvLyBub3QgcHVibGlzaGVkIG5vZGVfbW9kdWxlczsgUm9sbHVwJ3MgZGVmYXVsdCBjb21tb25qcyBoYW5kbGluZyBtaXNzZXMgc29tZSBvZiBpdHNcbiAgICAgIC8vIHJlLWV4cG9ydGVkIG5hbWVkIGV4cG9ydHMgKGUuZy4gSEVBREVSUykgdW5sZXNzIGV4cGxpY2l0bHkgaW5jbHVkZWQgaGVyZS5cbiAgICAgIGluY2x1ZGU6IFsvc2hhcmVkXFwvZGlzdC8sIC9ub2RlX21vZHVsZXMvXSxcbiAgICB9LFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICAvLyBWZW5kb3IgY29kZSBjaGFuZ2VzIGZhciBsZXNzIG9mdGVuIHRoYW4gYXBwIGNvZGUgYW5kIGlzIHNoYXJlZCBhY3Jvc3MgZXZlcnlcbiAgICAgICAgLy8gcm91dGUgcmVnYXJkbGVzcyBvZiB0aGUgcGFnZS1sZXZlbCBjb2RlLXNwbGl0dGluZyBpbiBzcmMvcm91dGVzLnRzeCwgc28gaXQgaXNcbiAgICAgICAgLy8gc3BsaXQgaW50byBpdHMgb3duIGxvbmctbGl2ZWQgY2FjaGVhYmxlIGNodW5rcyByYXRoZXIgdGhhbiBsZWZ0IGluIHRoZSBvbmVcbiAgICAgICAgLy8gXCJldmVyeXRoaW5nIGVsc2VcIiBidW5kbGUuXG4gICAgICAgIG1hbnVhbENodW5rczoge1xuICAgICAgICAgICd2ZW5kb3ItcmVhY3QnOiBbJ3JlYWN0JywgJ3JlYWN0LWRvbScsICdyZWFjdC1yb3V0ZXItZG9tJ10sXG4gICAgICAgICAgJ3ZlbmRvci11aSc6IFsncmFkaXgtdWknLCAnbHVjaWRlLXJlYWN0JywgJ2NtZGsnLCAnc29ubmVyJywgJ3ZhdWwnLCAncmVhY3QtcmVzaXphYmxlLXBhbmVscyddLFxuICAgICAgICAgICd2ZW5kb3ItdGFibGUnOiBbJ0B0YW5zdGFjay9yZWFjdC10YWJsZSddLFxuICAgICAgICAgICd2ZW5kb3ItcXVlcnknOiBbJ0B0YW5zdGFjay9yZWFjdC1xdWVyeScsICdheGlvcyddLFxuICAgICAgICAgICd2ZW5kb3ItZm9ybXMnOiBbJ3JlYWN0LWhvb2stZm9ybScsICdAaG9va2Zvcm0vcmVzb2x2ZXJzJywgJ3pvZCddLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBvcHRpbWl6ZURlcHM6IHtcbiAgICBpbmNsdWRlOiBbJ0BtZW51Ym9hcmQvc2hhcmVkJ10sXG4gICAgLy8gQG1lbnVib2FyZC9zaGFyZWQgaXMgYSBsaW5rZWQgd29ya3NwYWNlIHBhY2thZ2U6IFZpdGUga2V5cyBpdHMgcHJlLWJ1bmRsZSBjYWNoZSBvblxuICAgIC8vIGNvbmZpZyBhbmQgbG9ja2ZpbGUsIG5laXRoZXIgb2Ygd2hpY2ggY2hhbmdlcyB3aGVuIHNoYXJlZC9kaXN0IGlzIHJlYnVpbHQsIHNvIHRoZVxuICAgIC8vIGJyb3dzZXIgd291bGQga2VlcCBydW5uaW5nIGFuIG91dGRhdGVkIGNvcHkgKG1pc3NpbmcgZW51bSBtZW1iZXJzIHJlYWQgYXMgdW5kZWZpbmVkKS5cbiAgICBmb3JjZTogdHJ1ZSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUE4TyxPQUFPLFVBQVU7QUFDL1AsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxXQUFXO0FBQ2xCLE9BQU8saUJBQWlCO0FBSHhCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLEdBQUcsWUFBWSxDQUFDO0FBQUEsRUFDaEMsU0FBUztBQUFBO0FBQUE7QUFBQSxJQUdQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLE9BQU87QUFBQSxJQUN0QztBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxFQUNkO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixXQUFXO0FBQUEsSUFDWCxpQkFBaUI7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUlmLFNBQVMsQ0FBQyxnQkFBZ0IsY0FBYztBQUFBLElBQzFDO0FBQUEsSUFDQSxlQUFlO0FBQUEsTUFDYixRQUFRO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxRQUtOLGNBQWM7QUFBQSxVQUNaLGdCQUFnQixDQUFDLFNBQVMsYUFBYSxrQkFBa0I7QUFBQSxVQUN6RCxhQUFhLENBQUMsWUFBWSxnQkFBZ0IsUUFBUSxVQUFVLFFBQVEsd0JBQXdCO0FBQUEsVUFDNUYsZ0JBQWdCLENBQUMsdUJBQXVCO0FBQUEsVUFDeEMsZ0JBQWdCLENBQUMseUJBQXlCLE9BQU87QUFBQSxVQUNqRCxnQkFBZ0IsQ0FBQyxtQkFBbUIsdUJBQXVCLEtBQUs7QUFBQSxRQUNsRTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ1osU0FBUyxDQUFDLG1CQUFtQjtBQUFBO0FBQUE7QUFBQTtBQUFBLElBSTdCLE9BQU87QUFBQSxFQUNUO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
