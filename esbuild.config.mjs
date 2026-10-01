import { build, context } from 'esbuild';
import { mkdir, copyFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const watch=process.argv.includes('--watch');
const options={entryPoints:['src/main.ts'],bundle:true,alias:{'react-dom/client':'preact/compat/client','react-dom':'preact/compat','react/jsx-runtime':'preact/jsx-runtime','react':'preact/compat'},external:['obsidian'],format:'cjs',platform:'browser',target:'es2020',outfile:'main.js',jsx:'automatic',logLevel:'info',sourcemap:watch?'inline':false,minify:!watch,define:{'process.env.NODE_ENV':JSON.stringify(watch?'development':'production')},banner:{js:'/* Qard — local-first Obsidian study workspace. MIT license. */'}};
const FILES=['main.js','manifest.json','styles.css'];

// Optional: copy each build into a vault you name (--vault=PATH or QARD_VAULT). Only the three plugin files are copied;
// data.json (settings and review history) is never touched. The folder must already be a vault.
const vaultArg=process.argv.find(a=>a.startsWith('--vault='))?.slice(8)||process.env.QARD_VAULT;
let pluginDir;
if(vaultArg){
  const vault=resolve(vaultArg.replace(/^~(?=$|\/)/,homedir()));
  try{if(!(await stat(join(vault,'.obsidian'))).isDirectory())throw new Error();}catch{console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`);process.exit(1);}
  pluginDir=join(vault,'.obsidian','plugins','qard');
  await mkdir(pluginDir,{recursive:true});
  // The Hot Reload plugin reloads plugin folders that contain this marker.
  await writeFile(join(pluginDir,'.hotreload'),'',{flag:'a'});
}
async function install(){
  if(!pluginDir)return;
  for(const file of FILES)await copyFile(file,join(pluginDir,file));
  console.log(`[qard] installed into ${pluginDir} at ${new Date().toLocaleTimeString()}`);
}
// styles.css and manifest.json are not part of the bundle, so they are copied on every rebuild too.
const copyToVault={name:'copy-to-vault',setup(b){b.onEnd(async r=>{if(!r.errors.length)await install().catch(e=>console.error(`[qard] could not copy into the vault: ${e.message}`));});}};

if(watch){
  const ctx=await context({...options,plugins:[copyToVault]});
  await ctx.watch();
  // Edits to styles.css alone do not trigger esbuild, so rebuild when it changes.
  if(pluginDir){const { watch: fsWatch }=await import('node:fs');fsWatch('styles.css',()=>void ctx.rebuild().catch(()=>{}));}
}else{
  await build({...options,plugins:[copyToVault]});
  await mkdir('release/qard',{recursive:true});for(const file of FILES)await copyFile(file,`release/qard/${file}`);
}
