import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
assert.equal(manifest.version, pkg.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
if (process.env.GITHUB_REF_TYPE === 'tag')
  assert.equal(process.env.GITHUB_REF_NAME, manifest.version);
assert.deepEqual((await readdir('release/qard')).sort(), [
  'main.js',
  'manifest.json',
  'styles.css',
]);
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  assert.deepEqual(await readFile(`release/qard/${file}`), await readFile(file));
}
const bundle = await readFile('main.js', 'utf8');
assert.doesNotMatch(
  bundle,
  /createElement\(\s*["']script["']/i,
  'Release must not include dynamic script loaders',
);
assert.doesNotMatch(
  bundle,
  /example-tcp|example-bayes|example-binary-search/,
  'Release must not include demo cards',
);
assert.doesNotMatch(
  bundle,
  /(?:navigator\.)?clipboard\s*(?:\?\.|\.|\[)/,
  'Release must not access the system clipboard',
);
console.log(
  `Verified release ${manifest.version}: matching metadata, three install files, no script loaders or demo cards.`,
);
