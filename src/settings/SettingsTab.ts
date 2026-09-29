import { PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import type QardPlugin from '../main';
import type { QardSettings, TestSettings } from './settings';
import { API_MODELS, DEFAULT_API_MODEL } from '../agents/api-runner';
import { API_KEY_SECRET, detectAgent, secrets as secretStore } from '../agents/create-runner';
import { safeFolder } from '../cards/card-writer';
interface SettingRow { name: string; desc?: string; render: (setting: Setting) => void }
export class QardSettingsTab extends PluginSettingTab {
  constructor(private qard: QardPlugin) { super(qard.app, qard); }
  // Obsidian 1.13+ discovers these definitions for rendering and settings search.
  // Earlier supported versions call display(), which uses the same rows.
  getSettingDefinitions() {
    return [{ type: 'group' as const, heading: 'Study preferences', items: this.studyDefinitions() }, { type: 'group' as const, heading: 'Practice tests', items: this.testDefinitions() }, { type: 'group' as const, heading: 'Import', items: this.importDefinitions() }];
  }
  private studyDefinitions(): SettingRow[] {
    const settings = this.qard.reviews.getSnapshot().settings;
    const save = async <K extends keyof QardSettings>(key: K, value: QardSettings[K]) => {
      try { await this.qard.reviews.saveSettings({ ...this.qard.reviews.getSnapshot().settings, [key]: value }); }
      catch { new Notice('Could not save that preference. Please reopen settings and try again.'); }
    };
    return [
      { name: 'Default study mode', desc: 'All cards always includes every selected card.', render: row => { row.addDropdown(d => d.addOptions({ all: 'All cards', due: 'Due cards', new: 'New cards', difficult: 'Difficult cards' }).setValue(settings.defaultMode).onChange(v => void save('defaultMode', v as QardSettings['defaultMode']))); } },
      { name: 'Default order', render: row => { row.addDropdown(d => d.addOptions({ note: 'Deck / note order', shuffle: 'Shuffle' }).setValue(settings.defaultOrder).onChange(v => void save('defaultOrder', v as QardSettings['defaultOrder']))); } },
      ...([
        ['keyboardHints', 'Show keyboard hints', 'Space to reveal. 1–4 to rate. F for focus. Escape to leave focus.'],
        ['autoFocus', 'Enter focus mode when studying', 'Study across the full workspace, without relying on OS fullscreen.'],
        ['scheduling', 'Enable spaced repetition', 'Ratings update future due dates. Turning this off never limits manual study.'],
        ['audioEnabled', 'Local voice answers', 'Ask for microphone access only when Record answer is pressed. Recordings are temporary and never uploaded.']
      ] as const).map(([key, name, desc]) => ({ name, desc, render: (row: Setting) => { row.addToggle(t => t.setValue(settings[key]).onChange(v => void save(key, v))); } })),
      { name: 'New-card folder', desc: 'Vault-relative folder for new cards. Selections stay beside their source note.', render: row => { row.addText(t => {
        t.setValue(settings.cardFolder).setPlaceholder('Qard');
        t.inputEl.addEventListener('change', () => { try { const folder = safeFolder(t.getValue()); void save('cardFolder', folder); } catch (e) { new Notice((e as Error).message); t.setValue(this.qard.reviews.getSnapshot().settings.cardFolder); } });
      }); } },
      { name: 'Support Qard', desc: 'Enjoying Qard? You can support its development with a coffee.', render: row => {
        const link = row.controlEl.createEl('a', {
          cls: 'qard-coffee-button',
          href: 'https://buymeacoffee.com/kylianmarceau',
          attr: { target: '_blank', rel: 'noopener noreferrer' }
        });
        setIcon(link.createSpan({ attr: { 'aria-hidden': 'true' } }), 'coffee');
        link.createSpan({ text: 'Buy me a coffee' });
      } }
    ];
  }
  private testDefinitions(): SettingRow[] {
    const t = this.qard.reviews.getSnapshot().settings.tests;
    const save = async (patch: Partial<TestSettings>, redraw = false) => {
      try { await this.qard.reviews.saveSettings({ ...this.qard.reviews.getSnapshot().settings, tests: { ...this.qard.reviews.getSnapshot().settings.tests, ...patch } }); if (redraw) this.redraw(); }
      catch { new Notice('Could not save that preference. Please reopen settings and try again.'); }
    };
    const cli = t.provider !== 'anthropic', secrets = secretStore(this.app);
    const rows: SettingRow[] = [
      { name: 'AI provider', desc: cli ? 'Checking…' : 'Qard calls the Anthropic API directly. Also works on mobile.', render: row => {
        row.addDropdown(d => d.addOptions({ 'claude-code': 'Claude Code', codex: 'Codex', anthropic: 'Anthropic API key' }).setValue(t.provider).onChange(v => void save({ provider: v as TestSettings['provider'], model: '' }, true)));
        if (cli) void detectAgent(t).then(found => row.setDesc(found ? `Found at ${found}. Uses your ${t.provider === 'codex' ? 'Codex' : 'Claude'} login, and can only read your vault.` : 'Not found on this computer. Install it, or set its path below. Needs the desktop app.'));
      } }
    ];
    if (cli) rows.push(
      { name: `${t.provider === 'codex' ? 'Codex' : 'Claude Code'} path`, desc: 'Leave empty to find it automatically.', render: row => { row.addText(x => { x.setValue(t.agentPath).setPlaceholder('Detected automatically'); x.inputEl.addEventListener('change', () => void save({ agentPath: x.getValue().trim() }, true)); }); } },
      { name: 'Model', desc: 'Leave empty for the agent\'s default.', render: row => { row.addText(x => { x.setValue(t.model).setPlaceholder('Default'); x.inputEl.addEventListener('change', () => void save({ model: x.getValue().trim() })); }); } });
    else rows.push(
      { name: 'API key', desc: secrets ? 'Kept in Obsidian\'s secure storage, not in your vault or plugin data.' : 'Needs Obsidian 1.11.4 or newer.', render: row => { row.addText(x => { x.inputEl.type = 'password'; x.setPlaceholder(secrets?.getSecret(API_KEY_SECRET) ? 'Saved. Enter a new key to replace it.' : 'Anthropic API key'); x.setDisabled(!secrets); x.inputEl.addEventListener('change', () => { const key = x.getValue().trim(); if (!key || !secrets) return; secrets.setSecret(API_KEY_SECRET, key); x.setValue(''); x.setPlaceholder('Saved. Enter a new key to replace it.'); new Notice('API key saved.'); }); }); } },
      { name: 'Model', render: row => { row.addDropdown(d => d.addOptions(API_MODELS).setValue(API_MODELS[t.model] ? t.model : DEFAULT_API_MODEL).onChange(v => void save({ model: v }))); } });
    rows.push(
      { name: 'Plan tests first', desc: 'The default for the Plan first checkbox when you start a test.', render: row => { row.addToggle(x => x.setValue(t.planFirst).onChange(v => void save({ planFirst: v }))); } },
      { name: 'Mark answers', desc: 'After each section gives feedback as you go. At the end is closer to exam conditions.', render: row => { row.addDropdown(d => d.addOptions({ section: 'After each section', end: 'At the end' }).setValue(t.marking).onChange(v => void save({ marking: v as TestSettings['marking'] }))); } },
      { name: 'Default length', desc: 'A plan or prompt can override this.', render: row => { row.addDropdown(d => d.addOptions({ 5: 'About 5 questions', 10: 'About 10 questions', 15: 'About 15 questions', 20: 'About 20 questions' }).setValue(String(t.questions)).onChange(v => void save({ questions: Number(v) }))); } },
      { name: 'Use my study profile', desc: 'Tailor tests to past mistakes. Qard keeps the profile as _profile.md in the tests folder.', render: row => { row.addToggle(x => x.setValue(t.useProfile).onChange(v => void save({ useProfile: v }))); } },
      { name: 'Tests folder', desc: 'Plans, tests and your answers are saved here.', render: row => { row.addText(x => { x.setValue(t.folder).setPlaceholder('Tests folder'); x.inputEl.addEventListener('change', () => { try { const folder = safeFolder(x.getValue()); if (folder) void save({ folder }); else throw new Error('Choose a folder for tests.'); } catch (e) { new Notice((e as Error).message); x.setValue(this.qard.reviews.getSnapshot().settings.tests.folder); } }); }); } });
    return rows;
  }
  display() { this.redraw(); }
  // Conditional rows depend on the provider, so the whole tab is redrawn when it changes.
  private importDefinitions(): SettingRow[] {
    return [{ name: 'Import from Spaced Repetition', desc: 'Convert flashcards made for the Spaced Repetition plugin into Qard cards, keeping their review schedule.', render: row => { row.addButton(b => b.setButtonText('Import…').onClick(() => this.qard.openImport())); } }];
  }
  private redraw() {
    this.containerEl.empty();
    for (const group of this.getSettingDefinitions()) {
      new Setting(this.containerEl).setName(group.heading).setHeading();
      for (const definition of group.items) {
        const row = new Setting(this.containerEl).setName(definition.name);
        if (definition.desc) row.setDesc(definition.desc);
        definition.render(row);
      }
    }
  }
}
