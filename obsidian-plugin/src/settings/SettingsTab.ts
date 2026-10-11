import { PluginSettingTab, Setting, Notice } from 'obsidian';
import type QardPlugin from '../main';
import type { QardSettings } from './settings';
import { safeFolder } from '../cards/card-writer';
export class QardSettingsTab extends PluginSettingTab {
  constructor(private qard: QardPlugin) { super(qard.app, qard); }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl('h2', { text: 'Qard' });
    this.containerEl.createEl('p', { text: 'Your notes are the source of truth. Qard stores only settings and review history.' });
    const settings = this.qard.reviews.getSnapshot().settings;
    const save = async <K extends keyof QardSettings>(key: K, value: QardSettings[K]) => {
      try { await this.qard.reviews.saveSettings({ ...this.qard.reviews.getSnapshot().settings, [key]: value }); }
      catch { new Notice('Qard could not save that setting. Please try again.'); this.display(); }
    };
    new Setting(this.containerEl).setName('Default study mode').setDesc('All cards always includes every selected card.').addDropdown(d => d.addOptions({ all: 'All cards', due: 'Due cards', new: 'New cards', difficult: 'Difficult cards' }).setValue(settings.defaultMode).onChange(v => void save('defaultMode', v as QardSettings['defaultMode'])));
    new Setting(this.containerEl).setName('Default order').addDropdown(d => d.addOptions({ note: 'Deck / note order', shuffle: 'Shuffle' }).setValue(settings.defaultOrder).onChange(v => void save('defaultOrder', v as QardSettings['defaultOrder'])));
    for (const [key, name, desc] of [
      ['keyboardHints', 'Show keyboard hints', 'Space to reveal. 1–4 to rate. F for focus. Escape to leave focus.'],
      ['autoFocus', 'Enter focus mode when studying', 'Study across the full workspace, without relying on OS fullscreen.'],
      ['scheduling', 'Enable spaced repetition', 'Ratings update future due dates. Turning this off never limits manual study.'],
      ['audioEnabled', 'Local voice answers', 'Ask for microphone access only when Record answer is pressed. Recordings are temporary and never uploaded.']
    ] as const) new Setting(this.containerEl).setName(name).setDesc(desc).addToggle(t => t.setValue(settings[key]).onChange(v => void save(key, v)));
    new Setting(this.containerEl).setName('New-card folder').setDesc('Vault-relative folder for cards created in Qard. Selections stay beside their source note.').addText(t => {
      t.setValue(settings.cardFolder).setPlaceholder('Qard');
      t.inputEl.addEventListener('change', () => { try { const folder = safeFolder(t.getValue()); void save('cardFolder', folder); } catch (e) { new Notice((e as Error).message); t.setValue(this.qard.reviews.getSnapshot().settings.cardFolder); } });
    });
  }
}
