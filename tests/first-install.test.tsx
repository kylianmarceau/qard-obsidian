import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeckBrowser } from '../src/components/DeckBrowser';

const roots: string[] = [];
const script = fileURLToPath(new URL('../scripts/prepare-test-vault.mjs', import.meta.url));
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'qard-install-'));
  roots.push(root);
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await writeFile(join(root, file), 'test build');
  await mkdir(join(root, 'example-vault'));
  await writeFile(join(root, 'example-vault', 'Demo.md'), '> [!qard]- Demo question\n> Demo answer');
  return root;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it('default test installation adds only plugin configuration, without sample notes', async () => {
  const root = await setup();
  execFileSync(process.execPath, [script], { cwd: root });
  expect(await readdir(join(root, '.test-vault'))).toEqual(['.obsidian']);
  expect((await readdir(join(root, '.test-vault', '.obsidian/plugins/qard'))).sort())
    .toEqual(['main.js', 'manifest.json', 'styles.css']);
  await writeFile(join(root, '.test-vault', 'My notes.md'), 'Keep my notes');
  execFileSync(process.execPath, [script], { cwd: root });
  expect(await readFile(join(root, '.test-vault', 'My notes.md'), 'utf8')).toBe('Keep my notes');
  expect((await readdir(join(root, '.test-vault'))).sort()).toEqual(['.obsidian', 'My notes.md']);
});

it('examples require opt-in, stay in a separate vault, and never overwrite edited notes', async () => {
  const root = await setup();
  execFileSync(process.execPath, [script], { cwd: root });
  execFileSync(process.execPath, [script, '--examples'], { cwd: root });
  const example = join(root, '.example-test-vault', 'Demo.md');
  expect(await readFile(example, 'utf8')).toContain('Demo question');
  await writeFile(example, 'My edited card');
  execFileSync(process.execPath, [script, '--examples'], { cwd: root });
  expect(await readFile(example, 'utf8')).toBe('My edited card');
  expect(await readdir(join(root, '.test-vault'))).toEqual(['.obsidian']);
});

it('the empty library offers creation without showing example decks', () => {
  const noop = vi.fn();
  const html = renderToStaticMarkup(<DeckBrowser decks={[]} search="" onSearch={noop} open={noop} create={noop} study={noop} loading={false}/>);
  expect(html).toContain('No cards yet.');
  expect(html).toContain('Create a card');
  expect(html).not.toContain('qard-deck-name');
});

it('the library links to practice tests and shows an unfinished test', () => {
  const noop = vi.fn();
  const html = renderToStaticMarkup(<DeckBrowser decks={[]} search="" onSearch={noop} open={noop} create={noop} study={noop} loading={false} tests={noop} newTest={noop} learn={noop} resume={<button className="qard-resume">Continue HMM inference</button>}/>);
  expect(html).toContain('Practice test');
  expect(html.match(/role="tab"/g)).toHaveLength(3);
  expect(html).toContain('>Learn<');
  expect(html).toContain('Continue HMM inference');
});
