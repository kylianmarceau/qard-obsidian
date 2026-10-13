import { Modal, Setting } from 'obsidian';
import type QardPlugin from '../main';
import {
  countReviews,
  MIN_REVIEWS,
  optimizeParameters,
  trainingItems,
  type Fit,
  type OptimizeResult,
} from '../review/fsrs-optimizer';

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const describe = (fit: Fit) =>
  `Prediction error ${fit.logLoss.toFixed(4)} · calibration gap ${percent(fit.calibration)}`;

/** Fits FSRS to the user's own ratings on this device; nothing changes until Apply. */
export class OptimizerModal extends Modal {
  private opened = false;
  private busy = false;
  private controller?: AbortController;
  constructor(private qard: QardPlugin) {
    super(qard.app);
  }
  onOpen() {
    this.opened = true;
    this.setTitle('Personalise FSRS');
    this.modalEl.addClass('qard-import-modal');
    this.overview();
  }
  onClose() {
    this.opened = false;
    this.controller?.abort();
    this.contentEl.empty();
  }
  private message(text: string, alert = false) {
    this.contentEl.createEl('p', {
      text,
      ...(alert ? { attr: { role: 'alert' }, cls: 'qard-import-warning' } : {}),
    });
  }
  private overview(error?: string) {
    const el = this.contentEl,
      data = this.qard.reviews.getSnapshot(),
      { total, spaced } = countReviews(trainingItems(data.history));
    el.empty();
    this.message(
      'FSRS starts with parameters that suit most learners. Personalising fits them to your own ratings, so intervals match how you actually remember. It runs on this device and sends nothing anywhere.',
    );
    this.message(
      `${total.toLocaleString()} saved ratings, ${spaced.toLocaleString()} of them a day or more after the previous one. ${
        data.settings.fsrsParameters
          ? 'You are using personalised parameters.'
          : 'You are using the default parameters.'
      }`,
    );
    const fsrs = data.settings.scheduler === 'fsrs';
    if (!fsrs) {
      this.message('Choose FSRS as the review scheduler to use personalised parameters.', true);
    }
    if (error) {
      this.message(error, true);
    }
    const row = new Setting(el);
    if (data.settings.fsrsParameters) {
      row.addButton((b) =>
        b
          .setButtonText('Reset to defaults')
          .setDisabled(this.busy)
          .onClick(() => void this.save(undefined)),
      );
    }
    row.addButton((b) =>
      b
        .setButtonText(total < MIN_REVIEWS ? `Needs ${MIN_REVIEWS} ratings` : 'Find my parameters')
        .setCta()
        .setDisabled(this.busy || !fsrs || total < MIN_REVIEWS)
        .onClick(() => void this.run()),
    );
    row.addButton((b) => b.setButtonText('Close').onClick(() => this.close()));
  }
  private async run() {
    if (this.busy) {
      return;
    }
    this.busy = true;
    const controller = (this.controller = new AbortController());
    const el = this.contentEl;
    el.empty();
    this.message('Fitting parameters to your review history…');
    const bar = el.createEl('progress', { attr: { max: '1', value: '0' } });
    bar.setAttribute('aria-label', 'Personalising progress');
    new Setting(el).addButton((b) => b.setButtonText('Cancel').onClick(() => controller.abort()));
    try {
      const result = await optimizeParameters(
        trainingItems(this.qard.reviews.getSnapshot().history),
        { signal: controller.signal, onProgress: (done) => (bar.value = done) },
      );
      this.busy = false;
      if (this.opened) {
        this.result(result);
      }
    } catch (e) {
      this.busy = false;
      if (this.opened) {
        this.overview(controller.signal.aborted ? undefined : (e as Error).message);
      }
    }
  }
  private result(result: OptimizeResult) {
    const el = this.contentEl;
    el.empty();
    new Setting(el).setName('Default parameters').setDesc(describe(result.before));
    new Setting(el).setName('Your parameters').setDesc(describe(result.after));
    this.message(
      result.improved
        ? `Measured on your ${result.after.reviews.toLocaleString()} spaced reviews, your parameters predict your recall better than the defaults. Applying them updates each card's memory estimate; due dates already set stay as they are and new intervals use the new parameters.`
        : 'The defaults already predict your reviews as well as anything found, so there is nothing to apply.',
    );
    new Setting(el)
      .addButton((b) => b.setButtonText('Back').onClick(() => this.overview()))
      .addButton((b) =>
        b
          .setButtonText('Apply')
          .setCta()
          .setDisabled(!result.improved)
          .onClick(() => void this.save(result.parameters)),
      );
  }
  private async save(parameters: number[] | undefined) {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const { fsrsParameters: _old, ...settings } = this.qard.reviews.getSnapshot().settings;
      await this.qard.reviews.saveSettings({
        ...settings,
        ...(parameters ? { fsrsParameters: parameters } : {}),
      });
      this.busy = false;
      if (this.opened) {
        this.overview();
      }
    } catch {
      this.busy = false;
      if (this.opened) {
        this.overview('Could not save the parameters. Please try again.');
      }
    }
  }
}
