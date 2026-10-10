import { PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import type QardPlugin from '../main';
import type { QardSettings, RoleSetting, TestSettings } from './settings';
import type { AgentProvider, AgentRole } from '../agents/runner';
import { API_MODELS } from '../agents/api-runner';
import { openRouterModels } from '../agents/openrouter-runner';
import {
  API_KEY_SECRET,
  OPENROUTER_KEY_SECRET,
  defaultModel,
  detectAgent,
  nodeHost,
  secrets as secretStore,
} from '../agents/create-runner';
import { CLAUDE_CODE_MODELS, codexModels, type ModelChoice } from '../agents/cli-runner';
import { safeFolder } from '../cards/card-writer';
interface SettingRow {
  name: string;
  desc?: string;
  render: (setting: Setting) => void;
}
const PROVIDER_LABELS: Record<AgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  anthropic: 'Anthropic API',
  openrouter: 'OpenRouter',
};

export class QardSettingsTab extends PluginSettingTab {
  private models?: Promise<string[]>;
  /** Suggestions for a connection's model field. OpenRouter's list is fetched once per settings visit. */
  private async modelChoices(provider: AgentProvider): Promise<ModelChoice[]> {
    if (provider === 'claude-code') {
      return CLAUDE_CODE_MODELS;
    }
    if (provider === 'codex') {
      const host = nodeHost();
      return host ? codexModels(host) : [];
    }
    if (provider === 'openrouter') {
      return (await (this.models ??= openRouterModels().catch(() => []))).map((m) => ({
        value: m,
        label: m,
      }));
    }
    return [];
  }
  constructor(private qard: QardPlugin) {
    super(qard.app, qard);
  }
  // Obsidian 1.13+ discovers these definitions for rendering and settings search.
  // Earlier supported versions call display(), which uses the same rows.
  getSettingDefinitions() {
    const group = (heading: string, items: SettingRow[]) => ({
      type: 'group' as const,
      heading,
      items,
    });
    return [
      group('Study preferences', this.studyDefinitions()),
      group('AI connections', this.connectionDefinitions()),
      group('AI roles', this.roleDefinitions()),
      group('Practice tests', this.testDefinitions()),
      group('Lessons and checks', this.learnDefinitions()),
      group('Import and export', this.importDefinitions()),
      group('Study-progress backups', [
        {
          name: 'Manage study-progress backups',
          desc: 'Automatic local copies of reviews, schedules, saved sessions and exam plans. Preview before restoring.',
          render: (row) => {
            row.addButton((button) =>
              button.setButtonText('Manage backups').onClick(() => this.qard.openBackups()),
            );
          },
        },
      ]),
    ];
  }
  private studyDefinitions(): SettingRow[] {
    const settings = this.qard.reviews.getSnapshot().settings;
    const save = async <K extends keyof QardSettings>(key: K, value: QardSettings[K]) => {
      try {
        await this.qard.reviews.saveSettings({
          ...this.qard.reviews.getSnapshot().settings,
          [key]: value,
        });
        if (key === 'scheduler') {
          this.redraw();
        }
      } catch {
        new Notice('Could not save that preference. Please reopen settings and try again.');
      }
    };
    return [
      ...(['newCardsPerDay', 'reviewBatchSize'] as const).map((key) => ({
        name: key === 'newCardsPerDay' ? 'New cards per day' : 'Review batch size',
        desc:
          key === 'newCardsPerDay'
            ? 'Optional daily allowance across normal sessions. Learning repeats do not count. 0 means unlimited; cram and exam sessions are unrestricted.'
            : 'Optional number of cards per sitting, with Continue afterwards. Remaining cards stay due. 0 means the full selection.',
        render: (row: Setting) => {
          row.addText((text) =>
            text.setValue(String(settings[key])).onChange((value) => {
              if (/^\d+$/.test(value) && Number(value) <= 10000) {
                void save(key, Number(value));
              }
            }),
          );
        },
      })),
      {
        name: 'Default study mode',
        desc: 'All cards includes selected cards except paused cards and related cards deferred for today. Cram includes deferred cards.',
        render: (row) => {
          row.addDropdown((d) =>
            d
              .addOptions({
                all: 'All cards',
                due: 'Due cards',
                new: 'New cards',
                difficult: 'Difficult cards',
              })
              .setValue(settings.defaultMode)
              .onChange((v) => void save('defaultMode', v as QardSettings['defaultMode'])),
          );
        },
      },
      {
        name: 'Review scheduler',
        desc: 'FSRS adapts intervals to your memory. Switching preserves current due dates; the selected scheduler is used on your next review.',
        render: (row) => {
          row.addDropdown((d) =>
            d
              .addOptions({ fsrs: 'FSRS (adaptive memory)', simple: 'Simple intervals' })
              .setValue(settings.scheduler)
              .onChange((v) => void save('scheduler', v as QardSettings['scheduler'])),
          );
        },
      },
      {
        name: 'Target retention',
        desc: 'FSRS target for recall at the next review. Higher targets mean more frequent reviews. Existing due dates change as cards are reviewed.',
        render: (row) => {
          row.addText((t) => {
            t.inputEl.type = 'number';
            t.inputEl.min = '70';
            t.inputEl.max = '97';
            t.inputEl.step = '1';
            t.setValue(String(Math.round(settings.desiredRetention * 100))).setDisabled(
              settings.scheduler !== 'fsrs',
            );
            t.inputEl.addEventListener('change', () => {
              const value = Number(t.getValue());
              if (!Number.isFinite(value) || value < 70 || value > 97) {
                new Notice('Choose a target retention between 70% and 97%.');
                t.setValue(
                  String(
                    Math.round(this.qard.reviews.getSnapshot().settings.desiredRetention * 100),
                  ),
                );
                return;
              }
              void save('desiredRetention', value / 100);
            });
          });
        },
      },
      {
        name: 'Default order',
        render: (row) => {
          row.addDropdown((d) =>
            d
              .addOptions({ note: 'Deck / note order', shuffle: 'Shuffle' })
              .setValue(settings.defaultOrder)
              .onChange((v) => void save('defaultOrder', v as QardSettings['defaultOrder'])),
          );
        },
      },
      ...(
        [
          [
            'keyboardHints',
            'Show keyboard hints',
            'Space to reveal. 1–4 to rate. E to edit. F for focus. Escape to leave focus.',
          ],
          [
            'autoFocus',
            'Enter focus mode when studying',
            'Study across the full workspace, without relying on OS fullscreen.',
          ],
          [
            'scheduling',
            'Enable spaced repetition',
            'Ratings update future due dates. Turning this off never limits manual study.',
          ],
          [
            'burySiblings',
            'Separate related cards',
            'After a review, defer related cloze or image variants and linked reverse cards until tomorrow. Cram always includes them.',
          ],
          [
            'typedAnswers',
            'Type answers before revealing',
            'Optional scratch answer during flashcard review. Compare it yourself and choose a rating. Answers stay in this visit.',
          ],
          [
            'audioEnabled',
            'Local voice answers',
            'Ask for microphone access only when Record answer is pressed. Recordings are temporary and never uploaded.',
          ],
        ] as const
      ).map(([key, name, desc]) => ({
        name,
        desc,
        render: (row: Setting) => {
          row.addToggle((t) => t.setValue(settings[key]).onChange((v) => void save(key, v)));
        },
      })),
      {
        name: 'New-card folder',
        desc: 'Vault-relative folder for new cards. Selections stay beside their source note.',
        render: (row) => {
          row.addText((t) => {
            t.setValue(settings.cardFolder).setPlaceholder('Qard');
            t.inputEl.addEventListener('change', () => {
              try {
                const folder = safeFolder(t.getValue());
                void save('cardFolder', folder);
              } catch (e) {
                new Notice((e as Error).message);
                t.setValue(this.qard.reviews.getSnapshot().settings.cardFolder);
              }
            });
          });
        },
      },
      {
        name: 'Support Qard',
        desc: 'Enjoying Qard? You can support its development with a coffee.',
        render: (row) => {
          const link = row.controlEl.createEl('a', {
            cls: 'qard-coffee-button',
            href: 'https://buymeacoffee.com/kylianmarceau',
            attr: { target: '_blank', rel: 'noopener noreferrer' },
          });
          setIcon(link.createSpan({ attr: { 'aria-hidden': 'true' } }), 'coffee');
          link.createSpan({ text: 'Buy me a coffee' });
        },
      },
    ];
  }
  private patch(patch: (s: QardSettings) => QardSettings, redraw = false) {
    return this.qard.reviews.saveSettings(patch(this.qard.reviews.getSnapshot().settings)).then(
      () => {
        if (redraw) {
          this.redraw();
        }
      },
      () => {
        new Notice('Could not save that preference. Please reopen settings and try again.');
      },
    );
  }
  private secretRow(name: string, id: string, placeholder: string, desc: string): SettingRow {
    const store = secretStore(this.app);
    return {
      name,
      desc: store ? desc : 'Needs Obsidian 1.11.4 or newer.',
      render: (row) => {
        row.addText((x) => {
          x.inputEl.type = 'password';
          x.setPlaceholder(
            store?.getSecret(id) ? 'Saved. Enter a new key to replace it.' : placeholder,
          );
          x.setDisabled(!store);
          x.inputEl.addEventListener('change', () => {
            const key = x.getValue().trim();
            if (!key || !store) {
              return;
            }
            store.setSecret(id, key);
            x.setValue('');
            x.setPlaceholder('Saved. Enter a new key to replace it.');
            new Notice('Key saved.');
          });
        });
      },
    };
  }
  /** Set up once: which tools and keys Qard may use. */
  private connectionDefinitions(): SettingRow[] {
    const a = this.qard.reviews.getSnapshot().settings.agents;
    const cli = (
      provider: 'claude-code' | 'codex',
      label: string,
      key: 'claudePath' | 'codexPath',
    ): SettingRow => ({
      name: label,
      desc: 'Checking…',
      render: (row) => {
        row.addText((x) => {
          x.setValue(a[key]).setPlaceholder('Found automatically');
          x.inputEl.addEventListener(
            'change',
            () =>
              void this.patch(
                (s) => ({ ...s, agents: { ...s.agents, [key]: x.getValue().trim() } }),
                true,
              ),
          );
        });
        // Obsidian's Setting has a then() method, so returning it from a promise callback makes the promise adopt it
        // forever and freezes the app. Keep this callback returning nothing.
        void detectAgent(this.qard.reviews.getSnapshot().settings, provider).then((found) => {
          row.setDesc(
            found
              ? `Found at ${found}. Uses your existing login and can only read your vault.`
              : 'Not found. Install it, or enter its path. Needs the desktop app.',
          );
        });
      },
    });
    return [
      cli('claude-code', 'Claude Code', 'claudePath'),
      cli('codex', 'Codex', 'codexPath'),
      this.secretRow(
        'Anthropic API key',
        API_KEY_SECRET,
        'Anthropic API key',
        "Calls Claude directly. Works on mobile. Kept in Obsidian's secure storage.",
      ),
      this.secretRow(
        'OpenRouter API key',
        OPENROUTER_KEY_SECRET,
        'OpenRouter API key',
        "Any model on OpenRouter. Works on mobile. Kept in Obsidian's secure storage.",
      ),
    ];
  }
  /** Each role picks a connection and a model: a fast tutor, a careful writer and marker. */
  private roleDefinitions(): SettingRow[] {
    const roles = this.qard.reviews.getSnapshot().settings.agents.roles;
    const role = (id: AgentRole, name: string, desc: string): SettingRow => ({
      name,
      desc,
      render: (row) => {
        const current = roles[id],
          save = (next: RoleSetting, redraw = false) =>
            this.patch(
              (s) => ({ ...s, agents: { ...s.agents, roles: { ...s.agents.roles, [id]: next } } }),
              redraw,
            );
        row.addDropdown((d) =>
          d
            .addOptions(PROVIDER_LABELS)
            .setValue(current.provider)
            .onChange((v) => {
              const provider = v as AgentProvider;
              void save({ provider, model: defaultModel(provider, id) }, true);
            }),
        );
        if (current.provider === 'anthropic') {
          row.addDropdown((d) =>
            d
              .addOptions(API_MODELS)
              .setValue(API_MODELS[current.model] ? current.model : defaultModel('anthropic', id))
              .onChange((v) => void save({ ...current, model: v })),
          );
        } else {
          row.addText((x) => {
            x.setValue(current.model).setPlaceholder(
              defaultModel(current.provider, id) || 'Default model',
            );
            x.inputEl.addEventListener(
              'change',
              () => void save({ ...current, model: x.getValue().trim() }),
            );
            // A native suggestion list under the field: type to filter, or pick. Any other model name can still be typed.
            const list = (x.inputEl.parentElement ?? row.controlEl).createEl('datalist', {
              attr: { id: `qard-models-${id}` },
            });
            x.inputEl.setAttribute('list', list.id);
            void this.modelChoices(current.provider).then((choices) => {
              for (const c of choices) {
                list.createEl('option', { attr: { value: c.value, label: c.label } });
              }
            });
          });
        }
      },
    });
    return [
      {
        name: 'Show which agent is working',
        desc: 'A small label such as "Tutor · Claude Code · haiku" next to anything in progress.',
        render: (row) => {
          row.addToggle((t) =>
            t
              .setValue(this.qard.reviews.getSnapshot().settings.showAgent)
              .onChange((v) => void this.patch((s) => ({ ...s, showAgent: v }))),
          );
        },
      },
      {
        name: 'Token usage',
        desc: 'See how many tokens Qard has used, by feature and by connection and model.',
        render: (row) => {
          row.addButton((b) =>
            b.setButtonText('View usage').onClick(() => {
              (this.app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
              void this.qard.show('usage');
            }),
          );
        },
      },
      role(
        'tutor',
        'Tutor',
        'Replies live in lessons and marks checks. Choose a fast model. API keys respond fastest.',
      ),
      role(
        'writer',
        'Writer',
        'Maps courses and writes lessons, checks and tests. Choose your best model.',
      ),
      role('marker', 'Marker', 'Marks practice tests in the background.'),
      role(
        'illustrator',
        'Illustrator',
        'Draws figures for lessons: plots computed with Python on this computer, or diagrams. Choose a strong model.',
      ),
    ];
  }
  private testDefinitions(): SettingRow[] {
    const t = this.qard.reviews.getSnapshot().settings.tests;
    const save = (patch: Partial<TestSettings>) =>
      this.patch((s) => ({ ...s, tests: { ...s.tests, ...patch } }));
    return [
      {
        name: 'Plan tests first',
        desc: 'The default for the Plan first checkbox when you start a test.',
        render: (row) => {
          row.addToggle((x) =>
            x.setValue(t.planFirst).onChange((v) => void save({ planFirst: v })),
          );
        },
      },
      {
        name: 'Mark answers',
        desc: 'After each section gives feedback as you go. At the end is closer to exam conditions.',
        render: (row) => {
          row.addDropdown((d) =>
            d
              .addOptions({ section: 'After each section', end: 'At the end' })
              .setValue(t.marking)
              .onChange((v) => void save({ marking: v as TestSettings['marking'] })),
          );
        },
      },
      {
        name: 'Default length',
        desc: 'A plan or prompt can override this.',
        render: (row) => {
          row.addDropdown((d) =>
            d
              .addOptions({
                5: 'About 5 questions',
                10: 'About 10 questions',
                15: 'About 15 questions',
                20: 'About 20 questions',
              })
              .setValue(String(t.questions))
              .onChange((v) => void save({ questions: Number(v) })),
          );
        },
      },
      {
        name: 'Use my study profile',
        desc: 'Tailor tests to past mistakes. Qard keeps the profile as _profile.md in the tests folder.',
        render: (row) => {
          row.addToggle((x) =>
            x.setValue(t.useProfile).onChange((v) => void save({ useProfile: v })),
          );
        },
      },
      {
        name: 'Tests folder',
        desc: 'Plans, tests and your answers are saved here.',
        render: (row) => {
          row.addText((x) => {
            x.setValue(t.folder).setPlaceholder('Tests folder');
            x.inputEl.addEventListener('change', () => {
              try {
                const folder = safeFolder(x.getValue());
                if (folder) {
                  void save({ folder });
                } else {
                  throw new Error('Choose a folder for tests.');
                }
              } catch (e) {
                new Notice((e as Error).message);
                x.setValue(this.qard.reviews.getSnapshot().settings.tests.folder);
              }
            });
          });
        },
      },
    ];
  }
  private learnDefinitions(): SettingRow[] {
    const l = this.qard.reviews.getSnapshot().settings.learn;
    return [
      {
        name: 'Lessons and checks folder',
        desc: 'Lessons are saved in Lessons, and checks in Checks, inside this folder. Mastery files stay next to your course notes.',
        render: (row) => {
          row.addText((x) => {
            x.setValue(l.folder).setPlaceholder('Qard');
            x.inputEl.addEventListener('change', () => {
              try {
                const folder = safeFolder(x.getValue());
                if (folder) {
                  void this.patch((s) => ({ ...s, learn: { ...s.learn, folder } }));
                } else {
                  throw new Error('Choose a folder.');
                }
              } catch (e) {
                new Notice((e as Error).message);
                x.setValue(this.qard.reviews.getSnapshot().settings.learn.folder);
              }
            });
          });
        },
      },
      {
        name: 'Figures folder',
        desc: 'Figures the illustrator draws are saved here, in a subfolder per subject (e.g. assets/statistics), so you can reuse them in notes.',
        render: (row) => {
          row.addText((x) => {
            x.setValue(l.figures).setPlaceholder('Figures folder');
            x.inputEl.addEventListener('change', () => {
              try {
                const figures = safeFolder(x.getValue());
                if (figures) {
                  void this.patch((s) => ({ ...s, learn: { ...s.learn, figures } }));
                } else {
                  throw new Error('Choose a folder.');
                }
              } catch (e) {
                new Notice((e as Error).message);
                x.setValue(this.qard.reviews.getSnapshot().settings.learn.figures);
              }
            });
          });
        },
      },
    ];
  }
  display() {
    this.redraw();
  }
  // Conditional rows depend on the provider, so the whole tab is redrawn when it changes.
  private importDefinitions(): SettingRow[] {
    return [
      {
        name: 'Import flashcards from a file',
        desc: 'Preview and import CSV, TSV or Anki .apkg cards, including supported media and review data.',
        render: (row) => {
          row.addButton((b) =>
            b.setButtonText('Import…').onClick(() => this.qard.openTransfer('import')),
          );
        },
      },
      {
        name: 'Export flashcards',
        desc: 'Save all cards or a selected deck as CSV or TSV in your vault.',
        render: (row) => {
          row.addButton((b) =>
            b.setButtonText('Export…').onClick(() => this.qard.openTransfer('export')),
          );
        },
      },
      {
        name: 'Resume an unfinished import',
        desc: 'Finish an approved file import interrupted by a save error or restart.',
        render: (row) => {
          row.addButton((b) =>
            b.setButtonText('Resume…').onClick(() => this.qard.openTransfer('resume')),
          );
        },
      },
      {
        name: 'Import from Spaced Repetition',
        desc: 'Convert flashcards made for the Spaced Repetition plugin into Qard cards, keeping their review schedule.',
        render: (row) => {
          row.addButton((b) => b.setButtonText('Import…').onClick(() => this.qard.openImport()));
        },
      },
    ];
  }
  private redraw() {
    this.containerEl.empty();
    for (const group of this.getSettingDefinitions()) {
      new Setting(this.containerEl).setName(group.heading).setHeading();
      for (const definition of group.items) {
        const row = new Setting(this.containerEl).setName(definition.name);
        if (definition.desc) {
          row.setDesc(definition.desc);
        }
        definition.render(row);
      }
    }
  }
}
