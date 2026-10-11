import { cp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Intentionally fixed destination: never copy into a personal vault by accident.
const examples = process.argv.includes('--examples');
const dest = resolve(examples ? '.example-test-vault' : '.test-vault');
await mkdir(dest, { recursive: true });
// Examples are opt-in and isolated from the clean-install test vault.
// Never overwrite existing notes, even if the welcome note was removed.
if (examples) await cp('example-vault', dest, { recursive: true, force: false });
const pluginDir = dest + '/.obsidian/plugins/qard';
await mkdir(pluginDir, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css'])
  await copyFile(file, pluginDir + '/' + file);
await writeFile(dest + '/.obsidian/community-plugins.json', JSON.stringify(['qard']));
await writeFile(dest + '/.obsidian/app.json', JSON.stringify({ readableLineLength: true }));
console.log(
  'Test vault ready: ' +
    dest +
    '\nOpen this folder as a vault in Obsidian. Enable community plugins and Qard if prompted.',
);
console.log(
  examples
    ? 'Example notes included by request.'
    : 'No example notes added. Existing notes are preserved.',
);
