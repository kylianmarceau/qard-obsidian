import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Agent-written text can hold LaTeX and Markdown, so it must go through <Markdown> or <InlineMarkdown>, never straight into JSX.
const AGENT_FIELDS = [
  'connect',
  'why',
  'summary',
  'plan',
  'findings',
  'reply',
  'reteach',
  'explain',
  'model',
  'prompt',
  'feedback',
  'focus',
  'reason',
  'point',
  'body',
  'goal',
  'title',
];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });

it('agent-written fields are rendered, not shown as plain text', () => {
  const plain = new RegExp(`>\\{[\\w!?.\\[\\]]+\\.(${AGENT_FIELDS.join('|')})\\}`, 'g');
  const found = files(join(__dirname, '../src/components')).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        // SVG <title> tooltips can't render Markdown; they are the one allowed exception.
        [...line.matchAll(plain)]
          .filter((m) => !line.slice(Math.max(0, m.index! - 7), m.index!).includes('<title'))
          .map((m) => `${file.split('/src/')[1]}:${i + 1} ${m[0]}`),
      ),
  );
  expect(found).toEqual([]);
});
