import { expect, it } from 'vitest';
import { tidyMermaid } from '../src/learn/mermaid';

it('quotes node labels Mermaid cannot parse, and leaves valid ones alone', () => {
  const out = tidyMermaid(
    [
      '```mermaid',
      'graph TD',
      '  A[HTML = nested tags] --> B[Space = descendant: #block h3]',
      '  F[html_elements returns ALL matches] --> G[[[1]] takes one node, not a list]',
      '  G -->|uses f| H[html_attr(x) pulls "href"]',
      '  S[[subroutine]] --> DB[(Database)] & R(round (x))',
      '  Q{is it?} -- yes --> Z["already quoted"]',
      '```',
    ].join('\n'),
  ).split('\n');
  expect(out).toEqual([
    'graph TD',
    '  A[HTML = nested tags] --> B["Space = descendant: #block h3"]',
    '  F[html_elements returns ALL matches] --> G["[[1]] takes one node, not a list"]',
    '  G -->|uses f| H["html_attr(x) pulls #quot;href#quot;"]',
    '  S[[subroutine]] --> DB[(Database)] & R("round (x)")',
    '  Q{is it?} -- yes --> Z["already quoted"]',
  ]);
});
