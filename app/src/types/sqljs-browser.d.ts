/**
 * `@types/sql.js` only declares the package root, which resolves to the Node-flavoured
 * `dist/sql-wasm.js`. The web SQLite driver imports `dist/sql-wasm-browser.js` instead — the
 * same wasm binary with browser-only glue, so Metro never sees a Node built-in — and that
 * deep path has no types of its own.
 */
declare module 'sql.js/dist/sql-wasm-browser.js' {
  import type { SqlJsStatic } from 'sql.js';

  interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  const initSqlJs: (config?: InitSqlJsConfig) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
