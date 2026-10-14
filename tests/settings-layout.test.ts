// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import * as obsidian from 'obsidian';
import { QardSettingsTab } from '../src/settings/SettingsTab';
import { ReviewStore } from '../src/review/review-store';
import * as custom from '../src/agents/custom-runner';

vi.mock('obsidian', async (original) => {
  const base = await original<typeof obsidian>();
  class Setting {
    settingEl: HTMLElement;
    controlEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    constructor(container: HTMLElement) {
      this.settingEl = container.createDiv('setting-item');
      const info = this.settingEl.createDiv('setting-item-info');
      this.nameEl = info.createDiv('setting-item-name');
      this.descEl = info.createDiv('setting-item-description');
      this.controlEl = this.settingEl.createDiv('setting-item-control');
    }
    setName(name: string) {
      this.nameEl.textContent = name;
      return this;
    }
    setDesc(desc: string) {
      this.descEl.textContent = desc;
      return this;
    }
    setHeading() {
      this.settingEl.classList.add('setting-item-heading');
      return this;
    }
    then(callback: (row: this) => void) {
      callback(this);
      return this;
    }
    private control(tag: 'input' | 'select' | 'button', callback: (control: unknown) => void) {
      const el = document.createElement(tag);
      this.controlEl.append(el);
      const control = {
        inputEl: el,
        selectEl: el,
        buttonEl: el,
        setValue(value: string | boolean) {
          if (typeof value === 'boolean') (el as HTMLInputElement).checked = value;
          else (el as HTMLInputElement).value = value;
          return control;
        },
        getValue: () => (el as HTMLInputElement).value,
        setPlaceholder(value: string) {
          (el as HTMLInputElement).placeholder = value;
          return control;
        },
        setDisabled(value: boolean) {
          el.disabled = value;
          return control;
        },
        setButtonText(value: string) {
          el.textContent = value;
          return control;
        },
        addOptions(options: Record<string, string>) {
          for (const [value, text] of Object.entries(options))
            el.createEl('option', { text, attr: { value } });
          return control;
        },
        onChange(run: (value: string | boolean) => void) {
          el.addEventListener('change', () =>
            run(
              (el as HTMLInputElement).type === 'checkbox'
                ? (el as HTMLInputElement).checked
                : (el as HTMLInputElement).value,
            ),
          );
          return control;
        },
        onClick(run: () => void) {
          el.addEventListener('click', run);
          return control;
        },
      };
      callback(control);
      return this;
    }
    addText(callback: (control: unknown) => void) {
      return this.control('input', callback);
    }
    addDropdown(callback: (control: unknown) => void) {
      return this.control('select', callback);
    }
    addButton(callback: (control: unknown) => void) {
      return this.control('button', callback);
    }
    addToggle(callback: (control: unknown) => void) {
      return this.control('input', (control) => {
        (control as { inputEl: HTMLInputElement }).inputEl.type = 'checkbox';
        callback(control);
      });
    }
  }
  return { ...base, Setting };
});

HTMLElement.prototype.empty = function () {
  this.replaceChildren();
};
HTMLElement.prototype.createEl = function (
  this: HTMLElement,
  tag: string,
  options?: DomElementInfo,
) {
  const el = document.createElement(tag);
  if (options?.cls) el.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
  if (options?.text) el.textContent = String(options.text);
  for (const [name, value] of Object.entries(options?.attr ?? {}))
    el.setAttribute(name, String(value));
  this.append(el);
  return el;
} as typeof HTMLElement.prototype.createEl;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function fixture() {
  vi.spyOn(custom, 'customModels').mockResolvedValue([]);
  const reviews = new ReviewStore(async () => {});
  const tab = new QardSettingsTab({ app: {}, reviews } as never);
  const scroller = document.body.createDiv();
  tab.containerEl = scroller.createDiv();
  tab.display();
  const row = (name: string) =>
    Array.from(tab.containerEl.querySelectorAll<HTMLElement>('[data-qard-setting]')).find(
      (el) => el.dataset.qardSetting === name,
    )!;
  const redraw = vi.spyOn(tab as unknown as { redraw: () => void }, 'redraw');
  return { tab, reviews, scroller, row, redraw };
}

it('expands Advanced in place with focus and both scroll offsets intact on old and new Obsidian', () => {
  const { tab, row, scroller, redraw } = fixture();
  const refresh = vi.spyOn(tab, 'refreshDomState');
  const advanced = row('Advanced AI settings').querySelector('button')!;
  const server = row('Custom AI server');
  const tutor = row('Tutor');
  expect(server.hidden).toBe(true);
  advanced.focus();
  scroller.scrollTop = 800;
  tab.containerEl.scrollTop = 400;
  advanced.click();
  expect(server.hidden).toBe(false);
  expect(advanced.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(advanced);
  expect(row('Tutor')).toBe(tutor);
  expect(scroller.scrollTop).toBe(800);
  expect(tab.containerEl.scrollTop).toBe(400);
  expect(refresh).not.toHaveBeenCalled();
  vi.spyOn(obsidian, 'requireApiVersion').mockReturnValue(true);
  advanced.click();
  expect(server.hidden).toBe(true);
  expect(refresh).toHaveBeenCalledOnce();
  expect(redraw).not.toHaveBeenCalled();
});

it('updates only the changed role and keeps persisted values and focus', async () => {
  const { reviews, row, scroller, redraw } = fixture();
  const writer = row('Writer');
  const provider = row('Tutor').querySelector('select')!;
  provider.focus();
  scroller.scrollTop = 900;
  provider.value = 'custom';
  provider.dispatchEvent(new Event('change'));
  await reviews.flush();
  await vi.waitFor(() => expect(row('Tutor').querySelector('input')).not.toBeNull());
  expect(reviews.getSnapshot().settings.agents.roles.tutor).toEqual({
    provider: 'custom',
    model: '',
  });
  expect(row('Writer')).toBe(writer);
  expect(document.activeElement).toBe(row('Tutor').querySelector('select'));
  expect(scroller.scrollTop).toBe(900);
  expect(redraw).not.toHaveBeenCalled();
});

it('changes retention availability without replacing study controls', async () => {
  const { row, reviews, redraw } = fixture();
  const retention = row('Target retention').querySelector('input')!;
  const scheduler = row('Review scheduler').querySelector('select')!;
  scheduler.value = 'simple';
  scheduler.dispatchEvent(new Event('change'));
  await reviews.flush();
  await vi.waitFor(() => expect(retention.disabled).toBe(true));
  scheduler.value = 'fsrs';
  scheduler.dispatchEvent(new Event('change'));
  await reviews.flush();
  await vi.waitFor(() => expect(retention.disabled).toBe(false));
  expect(row('Target retention').querySelector('input')).toBe(retention);
  expect(redraw).not.toHaveBeenCalled();
});

it('preserves scroll and restores the focused setting when a bulk update rebuilds the page', () => {
  const { tab, row, scroller } = fixture();
  row('Tutor').querySelector('select')!.focus();
  scroller.scrollTop = 1200;
  tab.containerEl.scrollTop = 600;
  tab.display();
  expect(scroller.scrollTop).toBe(1200);
  expect(tab.containerEl.scrollTop).toBe(600);
  expect(document.activeElement).toBe(row('Tutor').querySelector('select'));
});

it('renders every definition once, and section links target their section', () => {
  const { tab } = fixture();
  const definitions = tab.getSettingDefinitions().flatMap((group) => group.items);
  expect(new Set(definitions.map((row) => row.name)).size).toBe(definitions.length);
  expect(tab.containerEl.querySelectorAll('[data-qard-setting]')).toHaveLength(definitions.length);
  const ai = tab.containerEl.querySelector<HTMLElement>('[data-qard-section="ai"]')!;
  ai.scrollIntoView = vi.fn();
  const link = Array.from(
    tab.containerEl.querySelectorAll<HTMLButtonElement>('.qard-settings-nav button'),
  ).find((button) => button.textContent === 'AI')!;
  link.click();
  expect(ai.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
});

it('hides AI settings while AI features are off and shows them again', async () => {
  const { reviews, row, tab } = fixture();
  const nav = () =>
    [...tab.containerEl.querySelectorAll<HTMLButtonElement>('.qard-settings-nav button')]
      .filter((button) => !button.hidden)
      .map((button) => button.textContent);
  expect(nav()).toEqual(['Study', 'AI', 'Tests', 'Files & data']);
  const toggle = row('AI features').querySelector('input')!;
  expect(toggle.checked).toBe(true);
  expect(row('Plan tests first')).toBeDefined();
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(row('Tutor')).toBeUndefined());
  expect(reviews.getSnapshot().settings.aiEnabled).toBe(false);
  expect(row('Anthropic API key')).toBeUndefined();
  expect(row('Plan tests first')).toBeUndefined();
  expect(row('Tests folder').hidden).toBe(true);
  expect(row('New-card folder').hidden).toBe(false);
  expect(nav()).toEqual(['Study', 'Files & data']);
  const again = row('AI features').querySelector('input')!;
  again.checked = true;
  again.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(row('Tutor')).toBeDefined());
  expect(row('Tests folder').hidden).toBe(false);
});

it('remaps a study key by pressing it, swapping a key already in use, and resets', async () => {
  const { reviews, row } = fixture();
  const good = row('Good');
  expect(good.hidden).toBe(true);
  row('Study keys').querySelector('button')!.click();
  expect(good.hidden).toBe(false);
  const button = good.querySelector('button')!;
  expect(button.textContent).toBe('3');
  button.click();
  expect(button.textContent).toBe('Press a key…');
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', bubbles: true }));
  expect(button.textContent).toBe('Press a key…');
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'U', bubbles: true }));
  await vi.waitFor(() => expect(reviews.getSnapshot().settings.studyKeys.good).toBe('u'));
  expect(reviews.getSnapshot().settings.studyKeys.undo).toBe('3');
  expect(button.textContent).toBe('U');
  expect(row('Undo last rating').querySelector('button')!.textContent).toBe('3');
  button.click();
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(button.textContent).toBe('U');
  [...row('Study keys').querySelectorAll('button')][1]!.click();
  await vi.waitFor(() => expect(reviews.getSnapshot().settings.studyKeys.good).toBe('3'));
  expect(button.textContent).toBe('3');
});
