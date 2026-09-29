import { PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import type QardPlugin from '../main';
import type { QardSettings } from './settings';
import { safeFolder } from '../cards/card-writer';
interface SettingRow { name: string; desc?: string; render: (setting: Setting) => void }
export class QardSettingsTab extends PluginSettingTab {
  constructor(private qard: QardPlugin) { super(qard.app, qard); }
  // Obsidian 1.13+ discovers these definitions for rendering and settings search.
  // Earlier supported versions call display(), which uses the same rows.
  getSettingDefinitions(): SettingRow[] {
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
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName('Study preferences').setHeading();
    for (const definition of this.getSettingDefinitions()) {
      const row = new Setting(this.containerEl).setName(definition.name);
      if (definition.desc) row.setDesc(definition.desc);
      definition.render(row);
    }
  }
}
