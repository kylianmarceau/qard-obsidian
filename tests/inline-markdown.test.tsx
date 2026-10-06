// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { Component } from 'obsidian';
import { InlineMarkdown } from '../src/components/Markdown';
import type { QardServices } from '../src/views/services';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('replaces a rendered title when the next title is plain text', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const services = { host, owner: new Component(), app: {} } as unknown as QardServices;
  const show = (text: string) =>
    act(async () => {
      root.render(
        <h1>
          <InlineMarkdown text={text} path="T.md" services={services} />
        </h1>,
      );
      await new Promise((r) => setTimeout(r, 0));
    });
  await show('Filter the `stop_words` dictionary');
  expect(host.textContent).toBe('Filter the `stop_words` dictionary');
  await show('Chain it into one pipeline');
  expect(host.textContent).toBe('Chain it into one pipeline');
  await show('Back to `code`');
  expect(host.textContent).toBe('Back to `code`');
  await act(async () => root.unmount());
  host.remove();
});
