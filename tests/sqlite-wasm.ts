import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export default new Uint8Array(
  readFileSync(resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm-browser.wasm')),
);
