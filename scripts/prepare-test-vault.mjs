import { cp, mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Intentionally fixed destination: never copy into a personal vault by accident.
const dest=resolve('.test-vault');
await mkdir(dest,{recursive:true});
try { await readFile(dest+'/Welcome.md'); } catch { await cp('example-vault',dest,{recursive:true}); }
const pluginDir=dest+'/.obsidian/plugins/qard';await mkdir(pluginDir,{recursive:true});
for(const file of ['main.js','manifest.json','styles.css'])await copyFile(file,pluginDir+'/'+file);
await writeFile(dest+'/.obsidian/community-plugins.json',JSON.stringify(['qard']));
await writeFile(dest+'/.obsidian/app.json',JSON.stringify({readableLineLength:true}));
console.log('Test vault ready: '+dest+'\nOpen this folder as a vault in Obsidian. Enable community plugins and Qard if prompted.');
