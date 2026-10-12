// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Platform, Setting } from 'obsidian';
import { LocalModelModal } from '../src/settings/LocalModelModal';
import { ReviewStore } from '../src/review/review-store';
import { CUSTOM_KEY_SECRET } from '../src/agents/create-runner';
import * as discovery from '../src/agents/local-models';
import * as custom from '../src/agents/custom-runner';

const servers = [
  {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: ['chat-a', 'chat-b'],
    needsKey: false,
  },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', models: ['chat-c'], needsKey: false },
];
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Platform.isDesktopApp = false;
  document.body.replaceChildren();
});

function fixture(desktop = true) {
  Platform.isDesktopApp = desktop;
  const persist = vi.fn(async () => {});
  const reviews = new ReviewStore(persist);
  const secrets = new Map([[CUSTOM_KEY_SECRET, 'old-hosted-key']]);
  const advanced = vi.fn(),
    saved = vi.fn();
  const modal = new LocalModelModal(
    {
      app: {
        secretStorage: {
          getSecret: (id: string) => secrets.get(id) ?? null,
          setSecret: (id: string, key: string) => secrets.set(id, key),
        },
      },
      reviews,
    } as never,
    advanced,
    saved,
  );
  const el = modal.contentEl;
  Object.assign(el, {
    empty: () => el.replaceChildren(),
    createEl(tag: string, options: { text?: string; attr?: Record<string, string> }) {
      const child = document.createElement(tag);
      child.textContent = options.text ?? '';
      for (const [key, value] of Object.entries(options.attr ?? {})) child.setAttribute(key, value);
      el.append(child);
      return child;
    },
  });
  const names = new WeakMap<Setting, string>();
  vi.spyOn(Setting.prototype, 'setName').mockImplementation(function (
    this: Setting,
    name: string | DocumentFragment,
  ) {
    names.set(this, typeof name === 'string' ? name : (name.textContent ?? ''));
    return this;
  });
  vi.spyOn(Setting.prototype, 'addDropdown').mockImplementation(function (this: Setting, callback) {
    const input = document.createElement('select');
    input.setAttribute('aria-label', names.get(this) ?? '');
    el.append(input);
    const dropdown = {
      addOption(value: string, text: string) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        input.append(option);
        return dropdown;
      },
      setValue(value: string) {
        input.value = value;
        return dropdown;
      },
      setDisabled(value: boolean) {
        input.disabled = value;
        return dropdown;
      },
      onChange(callback: (value: string) => void) {
        input.onchange = () => callback(input.value);
        return dropdown;
      },
    };
    callback(dropdown as never);
    return this;
  });
  vi.spyOn(Setting.prototype, 'addToggle').mockImplementation(function (this: Setting, callback) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', names.get(this) ?? '');
    el.append(input);
    const toggle = {
      setValue(value: boolean) {
        input.checked = value;
        return toggle;
      },
      setDisabled(value: boolean) {
        input.disabled = value;
        return toggle;
      },
      onChange(callback: (value: boolean) => void) {
        input.onchange = () => callback(input.checked);
        return toggle;
      },
    };
    callback(toggle as never);
    return this;
  });
  vi.spyOn(Setting.prototype, 'addButton').mockImplementation(function (this: Setting, callback) {
    const element = document.createElement('button');
    el.append(element);
    const button = {
      setButtonText(text: string) {
        element.textContent = text;
        return button;
      },
      setDisabled(value: boolean) {
        element.disabled = value;
        return button;
      },
      setCta() {
        return button;
      },
      onClick(handler: () => void) {
        element.onclick = handler;
        return button;
      },
    };
    callback(button as never);
    return this;
  });
  const detect = vi.spyOn(discovery, 'discoverLocalModels').mockResolvedValue(servers);
  const test = vi
    .spyOn(custom, 'testCustomConnection')
    .mockResolvedValue({ json: true, tools: true, message: 'Passed' });
  const button = (text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent === text)!;
  const change = (name: string, value: string) => {
    const select = el.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
  };
  modal.open();
  return { modal, el, reviews, secrets, persist, advanced, saved, detect, test, button, change };
}

it('lets users choose either server and model, tests synthetic replies and saves a working connection for all roles', async () => {
  const f = fixture();
  await settle();
  expect(f.persist).not.toHaveBeenCalled();
  f.change('Model', 'chat-b');
  f.change('Local server', servers[1]!.baseUrl);
  expect(f.el.querySelector<HTMLSelectElement>('select[aria-label="Model"]')!.value).toBe('chat-c');
  f.button('Test and connect').click();
  await settle();
  expect(f.test).toHaveBeenCalledWith(
    { baseUrl: servers[1]!.baseUrl, model: 'chat-c' },
    null,
    expect.any(AbortSignal),
  );
  const agents = f.reviews.getSnapshot().settings.agents;
  expect(agents.custom).toEqual({ baseUrl: servers[1]!.baseUrl, model: 'chat-c' });
  expect(Object.values(agents.roles)).toEqual(Array(4).fill({ provider: 'custom', model: '' }));
  expect(f.secrets.get(CUSTOM_KEY_SECRET)).toBe('');
  expect(f.saved).toHaveBeenCalledOnce();
  expect(f.modal.modalEl.isConnected).toBe(false);
});

it('can preserve existing role selections and defaults to the saved server and model', async () => {
  const f = fixture();
  await settle();
  await f.reviews.saveSettings({
    ...f.reviews.getSnapshot().settings,
    agents: {
      ...f.reviews.getSnapshot().settings.agents,
      custom: { baseUrl: servers[1]!.baseUrl, model: 'chat-c' },
    },
  });
  f.button('Try again').click();
  await settle();
  expect(f.el.querySelector<HTMLSelectElement>('select[aria-label="Local server"]')!.value).toBe(
    servers[1]!.baseUrl,
  );
  const previous = f.reviews.getSnapshot().settings.agents.roles;
  const toggle = f.el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change'));
  f.button('Test and connect').click();
  await settle();
  expect(f.reviews.getSnapshot().settings.agents.roles).toEqual(previous);
});

it('offers setup instructions and retry when no server is running, and Advanced settings on mobile', async () => {
  const f = fixture();
  f.detect.mockResolvedValue([]);
  await settle();
  f.button('Try again').click();
  await settle();
  expect(f.el.textContent).toContain('No local server found');
  expect(f.el.textContent).toContain('Start server');
  expect(f.button('Test and connect')).toBeUndefined();
  f.button('Advanced settings').click();
  expect(f.advanced).toHaveBeenCalledOnce();
  expect(f.persist).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  const phone = fixture(false);
  expect(phone.detect).not.toHaveBeenCalled();
  expect(phone.el.textContent).toContain('network address');
  expect(phone.button('Try again')).toBeUndefined();
  phone.modal.close();
});

it('explains empty model lists and authentication without claiming the server is absent', async () => {
  const f = fixture();
  await settle();
  f.detect.mockResolvedValue([
    { ...servers[0]!, models: [] },
    { ...servers[1]!, models: [], needsKey: true },
  ]);
  f.button('Try again').click();
  await settle();
  expect(f.el.textContent).toContain('no models are available');
  expect(f.button('Test and connect')).toBeUndefined();
  f.change('Local server', servers[1]!.baseUrl);
  expect(f.el.textContent).toContain('needs an API key');
  f.modal.close();
});

it('does not save a model that fails tools or JSON and restores a previous key if saving fails', async () => {
  const f = fixture();
  await settle();
  f.test.mockResolvedValueOnce({ json: true, tools: false, message: 'Partial' });
  f.button('Test and connect').click();
  await settle();
  expect(f.el.textContent).toContain('could not pass');
  expect(f.persist).not.toHaveBeenCalled();
  f.test.mockRejectedValueOnce(new Error('bad JSON'));
  f.button('Test and connect').click();
  await settle();
  expect(f.persist).not.toHaveBeenCalled();
  const previous = f.reviews.getSnapshot().settings;
  f.persist.mockRejectedValueOnce(new Error('disk full'));
  f.button('Test and connect').click();
  await settle();
  expect(f.reviews.getSnapshot().settings).toEqual(previous);
  expect(f.secrets.get(CUSTOM_KEY_SECRET)).toBe('old-hosted-key');
  expect(f.saved).not.toHaveBeenCalled();
  expect(f.el.textContent).toContain('Could not connect or save');
  f.button('Test and connect').click();
  await settle();
  expect(f.saved).toHaveBeenCalledOnce();
  expect(f.secrets.get(CUSTOM_KEY_SECRET)).toBe('');
});

it('ignores discovery results arriving after the setup window closes', async () => {
  const f = fixture();
  await settle();
  let finish!: (servers: discovery.LocalModelServer[]) => void;
  f.detect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.button('Try again').click();
  const signal = f.detect.mock.calls[1]![0];
  f.modal.close();
  expect(signal.aborted).toBe(true);
  finish(servers);
  await settle();
  expect(f.test).not.toHaveBeenCalled();
  expect(f.persist).not.toHaveBeenCalled();
  expect(f.modal.modalEl.isConnected).toBe(false);
});

it('cancels an in-flight check on close and ignores its late success', async () => {
  const f = fixture();
  await settle();
  let finish!: (result: custom.ConnectionCheck) => void;
  f.test.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.button('Test and connect').click();
  const signal = f.test.mock.calls[0]![2]!;
  expect(f.button('Test and connect').disabled).toBe(true);
  f.button('Cancel').click();
  expect(signal.aborted).toBe(true);
  finish({ json: true, tools: true, message: 'Late success' });
  await settle();
  expect(f.persist).not.toHaveBeenCalled();
  expect(f.saved).not.toHaveBeenCalled();
});

it('bounds the model check to one minute and returns a usable retry button', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await settle();
  f.test.mockReturnValueOnce(new Promise(() => {}));
  f.button('Test and connect').click();
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.test.mock.calls[0]![2]!.aborted).toBe(true);
  expect(f.button('Test and connect').disabled).toBe(false);
  expect(f.persist).not.toHaveBeenCalled();
  f.modal.close();
});
