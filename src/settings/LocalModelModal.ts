import { Modal, Setting, Platform, Notice } from 'obsidian';
import type QardPlugin from '../main';
import { discoverLocalModels, type LocalModelServer } from '../agents/local-models';
import { testCustomConnection } from '../agents/custom-runner';
import { CUSTOM_KEY_SECRET, secrets } from '../agents/create-runner';
import { deadline } from '../agents/runner';

export class LocalModelModal extends Modal {
  private opened = false;
  private work?: AbortController;
  private servers: LocalModelServer[] = [];
  private server?: LocalModelServer;
  private model = '';
  private useForAllRoles = true;
  private message = '';
  constructor(
    private qard: QardPlugin,
    private advanced: () => void,
    private saved: () => void,
  ) {
    super(qard.app);
  }
  onOpen() {
    this.opened = true;
    this.setTitle('Connect local model');
    if (Platform.isDesktopApp) {
      void this.discover();
    } else {
      this.message =
        'On a phone, use Advanced settings to enter your computer’s network address. Automatic detection only checks this device.';
      this.render();
    }
  }
  onClose() {
    this.opened = false;
    this.work?.abort();
  }
  private choose(server: LocalModelServer) {
    this.server = server;
    const current = this.qard.reviews.getSnapshot().settings.agents.custom;
    this.model =
      server.baseUrl === current.baseUrl && server.models.includes(current.model)
        ? current.model
        : (server.models[0] ?? '');
    this.message = server.needsKey
      ? `${server.name} needs an API key. Use Advanced settings to connect it.`
      : !server.models.length
        ? `${server.name} is running, but no models are available. Download a chat model in ${server.name}, then try again.`
        : '';
  }
  private async discover() {
    if (this.work) {
      return;
    }
    const controller = new AbortController();
    this.work = controller;
    this.message = 'Looking for Ollama and LM Studio…';
    this.render();
    try {
      const servers = await discoverLocalModels(controller.signal);
      if (!this.opened || controller.signal.aborted) {
        return;
      }
      this.servers = servers;
      if (servers.length) {
        const current = this.qard.reviews.getSnapshot().settings.agents.custom;
        this.choose(
          servers.find((s) => s.baseUrl === current.baseUrl && s.models.includes(current.model)) ??
            servers.find((s) => s.models.length) ??
            servers[0]!,
        );
      } else {
        this.server = undefined;
        this.model = '';
        this.message =
          'No local server found. Open Ollama, or switch on Start server in LM Studio’s Developer tab. Download a chat model, then try again. For a different port, use Advanced settings.';
      }
    } catch {
      if (!controller.signal.aborted) {
        this.message = 'Could not check local servers. Try again or use Advanced settings.';
      }
    } finally {
      if (this.work === controller) {
        this.work = undefined;
      }
      if (this.opened) {
        this.render();
      }
    }
  }
  private async connect() {
    if (this.work || !this.server || !this.model) {
      return;
    }
    const connection = { baseUrl: this.server.baseUrl, model: this.model };
    const controller = new AbortController();
    this.work = controller;
    this.message = 'Checking the model’s JSON replies and note tools… no vault notes are sent.';
    this.render();
    try {
      const result = await deadline(
        testCustomConnection(connection, null, controller.signal),
        controller.signal,
        60_000,
        'The local model',
      );
      if (!this.opened || controller.signal.aborted) {
        return;
      }
      if (!result.json || !result.tools) {
        this.message =
          'The model could not pass Qard’s JSON and note-tool checks. Choose another chat model and try again. Advanced settings can save a model with limited compatibility.';
        return;
      }
      // A previous failed write leaves the queue rejected; retry from its last committed snapshot.
      await this.qard.reviews.flush().catch(() => {});
      if (!this.opened || controller.signal.aborted) {
        return;
      }
      const settings = this.qard.reviews.getSnapshot().settings;
      const roles = { ...settings.agents.roles };
      if (this.useForAllRoles) {
        for (const role of ['tutor', 'writer', 'marker', 'illustrator'] as const) {
          roles[role] = { provider: 'custom', model: '' };
        }
      }
      // Discovery and the compatibility check used no key. Never reuse a former hosted-server key.
      const store = secrets(this.app);
      const previousKey = store?.getSecret(CUSTOM_KEY_SECRET) ?? '';
      store?.setSecret(CUSTOM_KEY_SECRET, '');
      try {
        await this.qard.reviews.saveSettings({
          ...settings,
          agents: { ...settings.agents, custom: connection, roles },
        });
      } catch (error) {
        store?.setSecret(CUSTOM_KEY_SECRET, previousKey);
        throw error;
      }
      new Notice(
        this.useForAllRoles
          ? 'Local model connected and selected for all AI roles.'
          : 'Local model connected. Choose Custom AI under AI roles to use it.',
      );
      this.close();
      this.saved();
    } catch {
      if (this.opened && !controller.signal.aborted) {
        this.message =
          'Could not connect or save this model. Check that it is running and supports JSON replies and tools, then try again.';
      }
    } finally {
      controller.abort();
      if (this.work === controller) {
        this.work = undefined;
      }
      if (this.opened) {
        this.render();
      }
    }
  }
  private render() {
    const el = this.contentEl;
    el.empty();
    el.createEl('p', {
      text: 'Connect a model from Ollama or LM Studio on this computer. Start your server and download a chat model first.',
    });
    if (this.message) {
      el.createEl('p', { text: this.message, attr: { role: 'status', 'aria-live': 'polite' } });
    }
    if (this.server) {
      new Setting(el).setName('Local server').addDropdown((d) => {
        for (const server of this.servers) {
          d.addOption(server.baseUrl, server.name);
        }
        d.setValue(this.server!.baseUrl)
          .setDisabled(!!this.work)
          .onChange((url) => {
            this.choose(this.servers.find((s) => s.baseUrl === url)!);
            this.render();
          });
      });
      new Setting(el).setName('Model').addDropdown((d) => {
        for (const model of this.server!.models) {
          d.addOption(model, model);
        }
        d.setValue(this.model)
          .setDisabled(!!this.work || !this.model)
          .onChange((model) => {
            this.model = model;
            this.message = '';
            this.render();
          });
      });
      new Setting(el)
        .setName('Use for all AI roles')
        .setDesc(
          'Use this model for tutor, writer, marker and illustrator. Turn off to keep your current role selections.',
        )
        .addToggle((toggle) =>
          toggle
            .setValue(this.useForAllRoles)
            .setDisabled(!!this.work)
            .onChange((value) => {
              this.useForAllRoles = value;
            }),
        );
    }
    new Setting(el)
      .addButton((button) =>
        button
          .setButtonText('Advanced settings')
          .setDisabled(!!this.work)
          .onClick(() => {
            this.close();
            this.advanced();
          }),
      )
      .addButton((button) =>
        button.setButtonText(this.work ? 'Cancel' : 'Close').onClick(() => this.close()),
      );
    const actions = new Setting(el);
    if (Platform.isDesktopApp) {
      actions.addButton((button) =>
        button
          .setButtonText('Try again')
          .setDisabled(!!this.work)
          .onClick(() => this.discover()),
      );
    }
    if (this.server?.models.length) {
      actions.addButton((button) =>
        button
          .setButtonText('Test and connect')
          .setCta()
          .setDisabled(!!this.work)
          .onClick(() => this.connect()),
      );
    }
  }
}
