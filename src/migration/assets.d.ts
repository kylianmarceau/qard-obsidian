declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
declare module 'sql.js/dist/sql-wasm-browser.js' {
  import init from 'sql.js';
  export default init;
}
