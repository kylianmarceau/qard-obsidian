// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { QardSettingsTab } from '../src/settings/SettingsTab';
import { ReviewStore } from '../src/review/review-store';
import { CUSTOM_KEY_SECRET } from '../src/agents/create-runner';
import * as custom from '../src/agents/custom-runner';
import { LocalModelModal } from '../src/settings/LocalModelModal';

afterEach(() => vi.restoreAllMocks());

function fixture(showAdvanced = true) {
  const secrets = new Map<string, string>();
  const reviews = new ReviewStore(async () => {});
  const plugin = {
    app: {
      secretStorage: {
        getSecret: (id: string) => secrets.get(id) ?? null,
        setSecret: (id: string, value: string) => secrets.set(id, value),
      },
    },
    reviews,
  };
  const tab = new QardSettingsTab(plugin as never);
  // Redrawing belongs to Obsidian; callbacks below exercise real controls and persisted settings.
  tab.containerEl = document.createElement('div');
  tab.containerEl.empty = () => tab.containerEl.replaceChildren();
  vi.spyOn(tab as unknown as { redraw: () => void }, 'redraw').mockImplementation(() => {});
  if (showAdvanced) {
    render(tab, 'Advanced AI settings').buttons[0]!.run!();
  }
  return { secrets, reviews, tab };
}
function controls() {
  const host = document.createElement('div');
  const inputs: HTMLInputElement[] = [],
    selects: HTMLSelectElement[] = [],
    buttons: { label: string; run?: () => void | Promise<void>; disabled: boolean }[] = [];
  const row = {
    description: '',
    controlEl: host,
    setDesc(value: string) {
      row.description = value;
      return row;
    },
    addText(callback: (x: unknown) => void) {
      const inputEl = document.createElement('input');
      inputs.push(inputEl);
      const parent = document.createElement('div');
      host.append(parent);
      parent.append(inputEl);
      parent.createEl = ((tag: string, options: { attr?: Record<string, string> }) => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(options.attr ?? {})) el.setAttribute(k, v);
        parent.append(el);
        el.empty = () => el.replaceChildren();
        el.createEl = ((name: string, opts: { attr?: Record<string, string> }) => {
          const child = document.createElement(name);
          for (const [k, v] of Object.entries(opts.attr ?? {})) child.setAttribute(k, v);
          el.append(child);
          return child;
        }) as typeof el.createEl;
        return el;
      }) as typeof parent.createEl;
      const x = {
        inputEl,
        setValue(value: string) {
          inputEl.value = value;
          return x;
        },
        getValue() {
          return inputEl.value;
        },
        setPlaceholder(value: string) {
          inputEl.placeholder = value;
          return x;
        },
        setDisabled(value: boolean) {
          inputEl.disabled = value;
          return x;
        },
      };
      callback(x);
      return row;
    },
    addDropdown(callback: (x: unknown) => void) {
      const input = document.createElement('select');
      selects.push(input);
      host.append(input);
      const x = {
        addOptions(options: Record<string, string>) {
          for (const [value, text] of Object.entries(options)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            input.append(option);
          }
          return x;
        },
        setValue(value: string) {
          input.value = value;
          return x;
        },
        onChange(run: (value: string) => void) {
          input.addEventListener('change', () => run(input.value));
          return x;
        },
      };
      callback(x);
      return row;
    },
    addButton(callback: (x: unknown) => void) {
      const state = {
        label: '',
        disabled: false,
        run: undefined as undefined | (() => void | Promise<void>),
      };
      buttons.push(state);
      const x = {
        setButtonText(value: string) {
          state.label = value;
          return x;
        },
        setDisabled(value: boolean) {
          state.disabled = value;
          return x;
        },
        onClick(run: () => void | Promise<void>) {
          state.run = run;
          return x;
        },
      };
      callback(x);
      return row;
    },
  };
  return { row, inputs, buttons, selects };
}
function change(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('change'));
}
function render(tab: QardSettingsTab, name: string) {
  const c = controls();
  tab
    .getSettingDefinitions()
    .flatMap((g) => g.items)
    .find((row) => row.name === name)!
    .render(c.row as never);
  return c;
}
it('starts with a local connect button and keeps manual configuration behind Advanced settings', async () => {
  const { tab } = fixture(false);
  const names = () =>
    tab
      .getSettingDefinitions()
      .flatMap((g) => g.items)
      .map((row) => row.name);
  expect(names()).toContain('Local AI model');
  expect(names()).not.toContain('Custom AI server');
  expect(render(tab, 'Local AI model').buttons[0]!.label).toBe('Connect local model');
  await render(tab, 'Advanced AI settings').buttons[0]!.run!();
  expect(names()).toContain('Custom AI server');
  expect(names()).toContain('Custom AI API key');
  await render(tab, 'Advanced AI settings').buttons[0]!.run!();
  expect(names()).not.toContain('Custom AI server');
});
it('opens local setup from settings and closes it when settings are hidden', async () => {
  const { tab } = fixture(false);
  const open = vi.spyOn(LocalModelModal.prototype, 'open').mockImplementation(() => {});
  const close = vi.spyOn(LocalModelModal.prototype, 'close').mockImplementation(() => {});
  await render(tab, 'Local AI model').buttons[0]!.run!();
  expect(open).toHaveBeenCalledOnce();
  tab.hide();
  expect(close).toHaveBeenCalledOnce();
});
it('persists custom server/model edits, rejects credential URLs and stores the optional key only in secret storage', async () => {
  const { tab, reviews, secrets } = fixture();
  const url = render(tab, 'Custom AI server');
  change(url.inputs[0]!, 'http://localhost:1234');
  await reviews.flush();
  expect(reviews.getSnapshot().settings.agents.custom.baseUrl).toBe('http://localhost:1234/v1');
  change(url.inputs[0]!, 'https://user:password@example.org');
  await reviews.flush();
  expect(url.inputs[0]!.value).toBe('http://localhost:1234/v1');
  const model = render(tab, 'Custom AI model');
  change(model.inputs[0]!, ' local ');
  await reviews.flush();
  expect(reviews.getSnapshot().settings.agents.custom.model).toBe('local');
  const key = render(tab, 'Custom AI API key');
  change(key.inputs[0]!, 'private-key');
  expect(key.inputs[0]!.type).toBe('password');
  expect(key.inputs[0]!.value).toBe('');
  expect(secrets.get(CUSTOM_KEY_SECRET)).toBe('private-key');
  expect(JSON.stringify(reviews.getSnapshot())).not.toContain('private-key');
  // Clear without needing to render the rest of the settings page in this control fixture.
  vi.spyOn(tab as unknown as { redraw: () => void }, 'redraw').mockImplementation(() => {});
  await key.buttons[0]!.run!();
  expect(secrets.get(CUSTOM_KEY_SECRET)).toBe('');
});
it('tests saved settings without vault access and cancels when the settings page closes', async () => {
  const { tab, reviews } = fixture();
  await reviews.saveSettings({
    ...reviews.getSnapshot().settings,
    agents: {
      ...reviews.getSnapshot().settings.agents,
      custom: { baseUrl: 'http://localhost:1234/v1', model: 'test' },
    },
  });
  const probe = vi
    .spyOn(custom, 'testCustomConnection')
    .mockResolvedValue({ json: true, tools: true, message: 'Both passed.' });
  const { row, buttons } = render(tab, 'Test custom AI connection');
  await buttons[0]!.run!();
  expect(probe).toHaveBeenCalledWith(
    { baseUrl: 'http://localhost:1234/v1', model: 'test' },
    null,
    expect.any(AbortSignal),
  );
  expect(row.description).toBe('Both passed.');
  expect(buttons[0]!.label).toBe('Test connection');
  probe.mockImplementation(
    async (_connection, _key, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(new Error('Cancelled.'))),
      ),
  );
  const pending = buttons[0]!.run!();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  tab.hide();
  await pending;
  expect(row.description).toBe('Connection test cancelled.');
  probe.mockRestore();
});

it('makes Custom AI available per role and leaves an empty override to inherit the shared model', async () => {
  const { tab, reviews } = fixture();
  vi.spyOn(tab as unknown as { redraw: () => void }, 'redraw').mockImplementation(() => {});
  await reviews.saveSettings({
    ...reviews.getSnapshot().settings,
    agents: {
      ...reviews.getSnapshot().settings.agents,
      custom: { baseUrl: 'http://localhost:1234/v1', model: 'shared-model' },
    },
  });
  const writer = render(tab, 'Writer');
  expect([...writer.selects[0]!.options].map((o) => o.textContent)).toContain('Custom AI');
  writer.selects[0]!.value = 'custom';
  writer.selects[0]!.dispatchEvent(new Event('change'));
  await reviews.flush();
  expect(reviews.getSnapshot().settings.agents.roles.writer).toEqual({
    provider: 'custom',
    model: '',
  });
  const next = render(tab, 'Writer');
  expect(next.inputs[0]!.placeholder).toBe('shared-model');
  change(next.inputs[0]!, 'override');
  await reviews.flush();
  expect(reviews.getSnapshot().settings.agents.roles.writer.model).toBe('override');
  expect(reviews.getSnapshot().settings.agents.roles.tutor.provider).toBe('claude-code');
});
