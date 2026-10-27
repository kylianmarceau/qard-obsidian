import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { QardApp } from './QardApp';
import type QardPlugin from '../main';
import type { QardServices } from './services';
import type { UiRequest } from './navigation';
import type { StudyAction, StudyCommands } from '../review/keyboard';
export const VIEW_TYPE = 'qard-workspace';
const TITLE_COURSE_MAX = 40;
/** "Qard · DS346", or "Qard" with no course; long courses are trimmed so the title stays short. */
export function qardTitle(course: string | undefined) {
  const name = course?.trim();
  if (!name) {
    return 'Qard';
  }
  return `Qard · ${name.length > TITLE_COURSE_MAX ? `${name.slice(0, TITLE_COURSE_MAX - 1).trimEnd()}…` : name}`;
}
export class QardView extends ItemView {
  private root?: Root;
  private host?: HTMLElement;
  private home?: HTMLElement;
  private focus = false;
  private services?: QardServices;
  private request?: UiRequest;
  private study?: StudyCommands;
  /** The course on this view's screen, from the study clock. */
  private course?: string;
  private title = 'Qard';
  private unsubscribe: (() => void)[] = [];
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: QardPlugin,
  ) {
    super(leaf);
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return this.plugin.reviews.getSnapshot().settings.courseInTitle === false
      ? 'Qard'
      : qardTitle(this.course);
  }
  /** Redraws the tab and window title when it changes; card-by-card review sets the same course on every card. */
  private refreshTitle() {
    const title = this.getDisplayText();
    if (title === this.title) {
      return;
    }
    this.title = title;
    // Both are internal: the tab header, then the window title (time trackers read it).
    const leaf = this.leaf as { updateHeader?: () => void },
      workspace = this.app?.workspace as { updateTitle?: () => void } | undefined;
    leaf.updateHeader?.();
    workspace?.updateTitle?.();
  }
  getIcon() {
    return 'qard';
  }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('qard-view-content');
    this.home = this.contentEl;
    this.host = this.contentEl.createDiv({ cls: 'qard-root' });
    this.services = {
      app: this.app,
      owner: this,
      host: this.host,
      index: this.plugin.index,
      writer: this.plugin.writer,
      reviews: this.plugin.reviews,
      tests: this.plugin.tests,
      learn: this.plugin.learn,
      jobs: this.plugin.jobs,
      flashcards: this.plugin.flashcards,
      sourceSync: this.plugin.sourceSync,
      improvements: this.plugin.improvements,
      time: this.plugin.time,
      setFocus: (enabled) => this.setFocus(enabled),
      isActive: () => this.app.workspace.getActiveViewOfType(QardView) === this,
      openSource: (card) => this.plugin.openSource(card),
      setStudyCommands: (commands) => {
        this.study = commands;
      },
    };
    this.root = createRoot(this.host);
    this.unsubscribe = [
      ...(this.plugin.time
        ? [
            this.plugin.time.onChange((view, context) => {
              if (view === this) {
                this.course = context?.course;
                this.refreshTitle();
              }
            }),
          ]
        : []),
      // The title setting can change while the view is open.
      this.plugin.reviews.subscribe(() => this.refreshTitle()),
    ];
    this.render();
  }
  /** Run a study action in this view's card session; false when none is running or it doesn't apply. */
  studyCommand(action: StudyAction, checking: boolean): boolean {
    return this.study?.(action, checking) ?? false;
  }
  show(request: UiRequest) {
    this.request = request;
    this.render();
  }
  private render() {
    if (this.root && this.services) {
      this.root.render(<QardApp services={this.services} request={this.request} />);
    }
  }
  setFocus(enabled: boolean) {
    if (!this.host || !this.home || enabled === this.focus) {
      return;
    }
    this.focus = enabled;
    const body = this.host.ownerDocument.body;
    if (enabled) {
      // Move the existing React host, rather than cloning its content. No Electron API required.
      body.appendChild(this.host);
      this.host.addClass('qard-focus-overlay');
      body.addClass('qard-focus-active');
    } else {
      this.host.removeClass('qard-focus-overlay');
      this.home.appendChild(this.host);
      if (!body.querySelector('.qard-focus-overlay')) {
        body.removeClass('qard-focus-active');
      }
    }
  }
  release() {
    this.study = undefined;
    this.plugin.time?.set(this, undefined);
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.course = undefined;
    this.refreshTitle();
    this.setFocus(false);
    this.root?.unmount();
    this.root = undefined;
    this.host?.remove();
    this.host = undefined;
    this.contentEl.removeClass('qard-view-content');
  }
  async onClose() {
    this.release();
  }
  onunload() {
    this.release();
  }
}
