import { Modal, Setting } from 'obsidian';
import type QardPlugin from '../main';
import type { ProgressBackup } from '../review/progress-backups';

export class BackupModal extends Modal {
  private opened = false;
  private busy = false;
  private generation = 0;
  constructor(private qard: QardPlugin) {
    super(qard.app);
  }
  onOpen() {
    this.opened = true;
    this.setTitle('Study-progress backups');
    void this.list();
  }
  onClose() {
    this.opened = false;
    this.generation++;
  }
  private error(error: unknown) {
    if (this.opened) {
      this.contentEl.createEl('p', { text: (error as Error).message, cls: 'qard-error' });
    }
  }
  private async list() {
    const generation = ++this.generation;
    try {
      const entries = await this.qard.backups.list();
      if (!this.opened || generation !== this.generation) {
        return;
      }
      this.contentEl.empty();
      this.contentEl.createEl('p', {
        text: 'Automatic local copies are kept on startup and every 30 minutes while progress changes, up to 30 copies. They include reviews, schedules, study time, saved sessions, exam plans and card/mastery links. Notes, attachments, source-tracking files and AI drafts are separate vault files and are not included.',
      });
      new Setting(this.contentEl).addButton((button) =>
        button
          .setButtonText('Back up now')
          .setDisabled(this.busy)
          .onClick(() => {
            if (this.busy) {
              return;
            }
            this.busy = true;
            button.setDisabled(true);
            void this.qard.reviews
              .flush()
              .then(() => this.qard.backups.capture(this.qard.reviews.getSnapshot(), true))
              .then(() => {
                this.busy = false;
                return this.list();
              })
              .catch((error: unknown) => {
                this.busy = false;
                button.setDisabled(false);
                this.error(error);
              });
          }),
      );
      if (!entries.length) {
        this.contentEl.createEl('p', { text: 'No study-progress backups yet.' });
      }
      for (const entry of entries) {
        const row = new Setting(this.contentEl)
          .setName(entry.backup ? new Date(entry.backup.createdAt).toLocaleString() : entry.name)
          .setDesc(
            entry.error ??
              `${entry.backup!.progress.history.length} reviews · ${entry.backup!.progress.sessions.length} saved sessions`,
          );
        if (entry.backup) {
          row.addButton((button) =>
            button
              .setButtonText('Preview restore')
              .onClick(() => this.preview(entry.name, entry.backup!)),
          );
        }
      }
    } catch (error) {
      this.error(error);
    }
  }
  private preview(name: string, backup: ProgressBackup) {
    if (this.busy) {
      return;
    }
    this.generation++;
    this.contentEl.empty();
    const current = this.qard.reviews.getSnapshot();
    this.contentEl.createEl('p', {
      text: `Restore study progress from ${new Date(backup.createdAt).toLocaleString()}? This replaces the current ${current.history.length} reviews with ${backup.progress.history.length}, ${current.sessions.length} saved sessions with ${backup.progress.sessions.length}, and ${current.exams.length} exam plans with ${backup.progress.exams.length}. Later progress will be replaced. Your current preferences and AI connections stay in place. Notes and attachments are not restored.`,
    });
    this.contentEl.createEl('p', {
      text: 'A fresh backup of your current progress is saved first. Return to the library before resuming study after restoration.',
    });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText('Cancel').onClick(() => {
          void this.list();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText('Restore this backup')
          .setClass('mod-warning')
          .onClick(() => {
            if (this.busy) {
              return;
            }
            this.busy = true;
            button.setDisabled(true);
            void this.qard.reviews
              .flush()
              .then(async () => {
                const verified = await this.qard.backups.read(name);
                if (!this.opened) {
                  return;
                }
                const current = this.qard.reviews.getSnapshot();
                await this.qard.backups.capture(current, true);
                if (!this.opened) {
                  return;
                }
                await this.qard.reviews.restoreProgress(verified.progress, current);
                await this.qard.show('today');
              })
              .then(() => this.close())
              .catch((error: unknown) => {
                this.busy = false;
                button.setDisabled(false);
                this.error(error);
              });
          }),
      );
  }
}
