import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmBinary from 'sql.js/dist/sql-wasm-browser.wasm';
import type { SqlJsStatic } from 'sql.js';
let loaded: Promise<SqlJsStatic> | undefined;
/** Both the engine and its WASM bytes are bundled. No runtime download or note tools. */
export function loadSqlite() {
  return (loaded ??= initSqlJs({ wasmBinary: wasmBinary.slice().buffer }));
}
