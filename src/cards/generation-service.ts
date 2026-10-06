import { readSourceSnapshots } from './source-sync-service';
import type { SourceSnapshot } from './source-sync-types';
import { CANCELLED, runValidated, type AgentRunner } from '../agents/runner';
import { safeFolder, type CardWriter } from './card-writer';
import { flashcardPrompt } from './generation-prompts';
import {
  flashcardBatchSchema,
  flashcardsSchema,
  readDestination,
  readFlashcardBatch,
  readFlashcards,
  type FlashcardDestination,
  type GeneratedContent,
} from './generation-schema';

export interface FlashcardRequest {
  prompt: string;
  deck?: string;
  topic?: string;
  notes: string[];
  folders?: string[];
}
export interface GeneratedDraft extends GeneratedContent {
  id: string;
  selected: boolean;
  added: boolean;
  sourceSnapshots?: SourceSnapshot[];
}
interface Batch {
  id: string;
  folder: string;
  request: FlashcardRequest;
  cards: GeneratedDraft[];
  destination?: FlashcardDestination;
  destinationLocked?: boolean;
}
export const flashcardDestination = (batch: Batch): FlashcardDestination =>
  batch.destination ?? { deck: batch.request.deck ?? '', topic: batch.request.topic ?? '' };
export const flashcardTopics = (batch: Batch): string[] => [
  ...new Set(batch.cards.map((c) => c.topic ?? flashcardDestination(batch).topic)),
];
const noteTopic = (source: string) =>
  source.replace(/\.md$/i, '').split('/').pop()!.replace(/_/g, ' ').trim().slice(0, 200);
export interface GenerationSnapshot {
  batch?: Batch;
  job?: { kind: 'flashcards'; startedAt: number; error?: string };
  saving: boolean;
  error?: string;
  loading: boolean;
}
interface DraftStorage {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}
const draftPath = (folder: string) => [folder, 'Flashcard drafts.json'].filter(Boolean).join('/');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A background writer job with a durable review draft. Only approved cards reach the card writer. */
export class FlashcardGenerationService {
  private snapshot: GenerationSnapshot = { saving: false, loading: true };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private writes = Promise.resolve();
  private disposed = false;
  constructor(
    private storage: DraftStorage,
    private folder: () => string,
    private paths: () => string[],
    private runner: () => AgentRunner,
    private writer: Pick<CardWriter, 'createBatch'>,
    private notify: (text: string) => void = () => {},
    private timing: (kind: string, ms: number) => void = () => {},
    private destinations: () => { name: string; topics: string[] }[] = () => [],
    private captureSources?: (
      paths: string[],
      unchangedSince?: number,
    ) => Promise<SourceSnapshot[]>,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<GenerationSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (!this.disposed) this.listeners.forEach((fn) => fn());
  }
  private persist() {
    const batch = this.snapshot.batch,
      path = draftPath(batch?.folder ?? safeFolder(this.folder()));
    const text = JSON.stringify(batch ?? null, null, 2) + '\n';
    const next = this.writes.catch(() => {}).then(() => this.storage.write(path, text));
    this.writes = next;
    return next;
  }
  async load() {
    try {
      const text = await this.storage.read(draftPath(safeFolder(this.folder())));
      if (!text || this.snapshot.batch || this.disposed) return;
      const value = JSON.parse(text) as Batch | null;
      if (!value) return;
      if (
        !/^[A-Za-z0-9_-]+$/.test(value.id) ||
        safeFolder(value.folder) !== safeFolder(this.folder())
      )
        throw new Error('Invalid saved flashcard draft.');
      const request = this.validateRequest(value.request);
      if (!Array.isArray(value.cards)) throw new Error('Invalid saved flashcard draft.');
      // Drafts may be mid-edit; the writer validates content when the student adds them.
      if (
        value.cards.some(
          (c) =>
            !c ||
            !/^[A-Za-z0-9_-]+$/.test(c.id) ||
            typeof c.front !== 'string' ||
            typeof c.back !== 'string' ||
            typeof c.source !== 'string' ||
            typeof c.selected !== 'boolean' ||
            typeof c.added !== 'boolean',
        ) ||
        new Set(value.cards.map((c) => c.id)).size !== value.cards.length
      )
        throw new Error('Invalid saved flashcard draft.');
      if (value.destination) readDestination(value.destination, false);
      if (value.destinationLocked !== undefined && typeof value.destinationLocked !== 'boolean')
        throw new Error('Invalid saved destination.');
      for (const card of value.cards) {
        if (card.sourceSnapshots !== undefined) readSourceSnapshots(card.sourceSnapshots);
        if (card.topic !== undefined)
          readDestination({ deck: 'validation', topic: card.topic }, false);
        if (value.destinationLocked || card.added)
          readDestination({
            ...flashcardDestination(value),
            topic: card.topic ?? flashcardDestination(value).topic,
          });
      }
      this.publish({
        batch: { ...value, request },
        job: value.cards.length
          ? undefined
          : {
              kind: 'flashcards',
              startedAt: Date.now(),
              error: 'Generation was interrupted. Try again when you are ready.',
            },
      });
    } catch (e) {
      this.publish({ error: `Could not restore flashcard drafts: ${message(e)}` });
    } finally {
      this.publish({ loading: false });
    }
  }
  private validateRequest(r: FlashcardRequest): FlashcardRequest {
    if (
      !r ||
      typeof r.prompt !== 'string' ||
      (r.deck !== undefined && typeof r.deck !== 'string') ||
      (r.topic !== undefined && typeof r.topic !== 'string') ||
      !Array.isArray(r.notes) ||
      r.notes.some((p) => typeof p !== 'string') ||
      (r.folders !== undefined &&
        (!Array.isArray(r.folders) || r.folders.some((p) => typeof p !== 'string')))
    )
      throw new Error('Invalid flashcard request.');
    const { deck, topic } = readDestination({ deck: r.deck ?? '', topic: r.topic ?? '' }, false),
      prompt = r.prompt.trim();
    if (prompt.length > 10000) throw new Error('Keep the prompt under 10,000 characters.');
    if (!prompt && !r.notes.length)
      throw new Error('Describe the cards or choose at least one note.');
    const folders = r.folders?.map(safeFolder);
    return {
      prompt,
      ...(deck ? { deck } : {}),
      ...(topic ? { topic } : {}),
      notes: [...new Set(r.notes)],
      ...(folders?.length ? { folders: [...new Set(folders)] } : {}),
    };
  }
  async start(request: FlashcardRequest) {
    if (this.snapshot.loading) throw new Error('Wait for saved drafts to load.');
    if (this.controller || this.snapshot.saving)
      throw new Error('Wait for the current flashcard job to finish.');
    const valid = this.validateRequest(request),
      available = this.paths();
    if (valid.notes.some((p) => !available.includes(p)))
      throw new Error('A selected note no longer exists. Choose the notes again.');
    const batch: Batch = {
      id: crypto.randomUUID(),
      folder: safeFolder(this.folder()),
      request: valid,
      cards: [],
    };
    this.publish({ batch, job: undefined, error: undefined, saving: true });
    try {
      await this.persist();
    } catch (e) {
      this.publish({
        job: {
          kind: 'flashcards',
          startedAt: Date.now(),
          error: `Could not save the request: ${message(e)}`,
        },
      });
      throw e;
    } finally {
      this.publish({ saving: false });
    }
    void this.generate();
  }
  async generate() {
    const batch = this.snapshot.batch;
    if (!batch || batch.cards.length || this.controller || this.snapshot.saving || this.disposed)
      return;
    const controller = new AbortController(),
      startedAt = Date.now();
    this.controller = controller;
    this.publish({ error: undefined, job: { kind: 'flashcards', startedAt } });
    const cancelled = new Promise<never>((_, reject) =>
      controller.signal.addEventListener('abort', () => reject(new Error(CANCELLED)), {
        once: true,
      }),
    );
    // Cancellation can happen while the request is still being persisted, before the provider race starts.
    cancelled.catch(() => {});
    try {
      await this.persist();
      if (controller.signal.aborted) throw new Error(CANCELLED);
      const paths = this.paths();
      if (batch.request.notes.some((p) => !paths.includes(p)))
        throw new Error(
          'A selected note no longer exists. Start a new batch and choose the notes again.',
        );
      const versions = await this.captureSources?.(batch.request.notes);
      if (versions?.some((s) => s.text === null))
        throw new Error('A selected source note is missing. Choose it again.');
      const infer = !batch.request.deck || !batch.request.topic;
      const result = await Promise.race([
        runValidated(
          this.runner(),
          {
            prompt: flashcardPrompt(batch.request, this.destinations(), versions),
            schema: infer ? flashcardBatchSchema : flashcardsSchema,
            signal: controller.signal,
            effort: 'high',
          },
          (v) => {
            if (!infer)
              return {
                destination: readDestination(flashcardDestination(batch)),
                cards: readFlashcards(v, paths),
              };
            const generated = readFlashcardBatch(v, paths);
            return {
              ...generated,
              destination: {
                deck: batch.request.deck || generated.destination.deck,
                topic: batch.request.topic || generated.destination.topic,
              },
            };
          },
        ),
        cancelled,
      ]);
      const discovered = [
        ...new Set(
          result.cards
            .map((c) => c.source)
            .filter((p) => p && !versions?.some((s) => s.path === p)),
        ),
      ];
      const sourceVersions = [
        ...(versions ?? []),
        ...((await this.captureSources?.(discovered, startedAt)) ?? []),
      ];
      if (controller.signal.aborted || this.disposed) return;
      this.publish({
        batch: {
          ...batch,
          destination: result.destination,
          cards: result.cards.map((c) => ({
            ...c,
            ...(batch.request.topic ? { topic: batch.request.topic } : {}),
            id: crypto.randomUUID(),
            selected: true,
            added: false,
            ...(sourceVersions.length
              ? { sourceSnapshots: sourceVersions.filter((s) => s.path === c.source) }
              : {}),
          })),
        },
      });
      await this.persist();
      if (this.disposed) return;
      this.publish({ job: undefined });
      this.timing('flashcards', Date.now() - startedAt);
      this.notify(`${result.cards.length} flashcards ready to review: ${result.destination.deck}`);
    } catch (e) {
      if (!this.disposed)
        this.publish({
          job: {
            kind: 'flashcards',
            startedAt,
            error: controller.signal.aborted ? CANCELLED : message(e),
          },
        });
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
  cancel() {
    this.controller?.abort();
  }
  updateDestination(patch: Partial<FlashcardDestination>) {
    const batch = this.snapshot.batch;
    if (
      !batch ||
      !batch.cards.length ||
      this.snapshot.saving ||
      this.controller ||
      batch.destinationLocked ||
      batch.cards.some((c) => c.added)
    )
      return;
    const destination = { ...flashcardDestination(batch), ...patch };
    try {
      readDestination(destination, false);
    } catch (e) {
      this.publish({ error: message(e) });
      return;
    }
    const cards =
      patch.topic !== undefined
        ? batch.cards.map((c) => ({ ...c, topic: destination.topic }))
        : batch.cards;
    this.publish({ batch: { ...batch, destination, cards }, error: undefined });
    void this.persist().catch((e) =>
      this.publish({ error: `Could not save the destination: ${message(e)}` }),
    );
  }
  updateCard(
    id: string,
    patch: Partial<Pick<GeneratedDraft, 'front' | 'back' | 'selected' | 'topic'>>,
  ) {
    const batch = this.snapshot.batch;
    if (!batch || this.snapshot.saving) return;
    if (patch.topic !== undefined) {
      if (batch.destinationLocked || batch.cards.some((c) => c.added)) return;
      try {
        readDestination({ deck: 'validation', topic: patch.topic }, false);
      } catch (e) {
        this.publish({ error: message(e) });
        return;
      }
    }
    this.publish({
      batch: {
        ...batch,
        cards: batch.cards.map((c) => (c.id === id && !c.added ? { ...c, ...patch } : c)),
      },
    });
    void this.persist().catch((e) =>
      this.publish({ error: `Could not save draft edits: ${message(e)}` }),
    );
  }
  useTopicsFromNotes() {
    const batch = this.snapshot.batch;
    if (
      !batch ||
      this.snapshot.saving ||
      this.controller ||
      batch.destinationLocked ||
      batch.cards.some((c) => c.added)
    )
      return;
    const sources = [...new Set(batch.cards.map((c) => c.source).filter(Boolean))];
    const names = sources.map(noteTopic);
    const topics = new Map(
      sources.map((source, i) => [
        source,
        names.filter((name) => name === names[i]).length > 1
          ? source.replace(/\.md$/i, '').replace(/_/g, ' ').slice(-200)
          : names[i]!,
      ]),
    );
    this.publish({
      batch: {
        ...batch,
        cards: batch.cards.map((c) => (c.source ? { ...c, topic: topics.get(c.source)! } : c)),
      },
      error: undefined,
    });
    void this.persist().catch((e) =>
      this.publish({ error: `Could not save topics: ${message(e)}` }),
    );
  }
  async addSelected() {
    const batch = this.snapshot.batch;
    if (!batch || this.snapshot.saving || this.controller) return;
    const cards = batch.cards.filter((c) => c.selected && !c.added);
    if (!cards.length) return;
    this.publish({ saving: true, error: undefined });
    try {
      const destination = readDestination(flashcardDestination(batch));
      for (const [i, card] of batch.cards.entries()) {
        try {
          readDestination({ ...destination, topic: card.topic ?? destination.topic });
        } catch {
          throw new Error(
            `Card ${i + 1} needs a topic on one line, up to 200 characters. Choose its topic before adding this batch.`,
          );
        }
      }
      // A write may succeed before indexing fails. Freeze its destination before trying,
      // so changing the name cannot put the same batch in a second note on retry.
      const savingBatch = { ...batch, destination, destinationLocked: true };
      this.publish({ batch: savingBatch });
      await this.persist();
      await this.writer.createBatch(
        { ...destination, folder: batch.folder, batchId: batch.id },
        cards,
      );
      const ids = new Set(cards.map((c) => c.id));
      this.publish({
        batch: {
          ...savingBatch,
          cards: batch.cards.map((c) => (ids.has(c.id) ? { ...c, added: true } : c)),
        },
      });
      await this.persist();
      this.notify(`${cards.length} flashcards added to ${destination.deck}`);
    } catch (e) {
      this.publish({ error: message(e) });
    } finally {
      this.publish({ saving: false });
    }
  }
  async clear() {
    if (this.controller || this.snapshot.saving) return;
    const batch = this.snapshot.batch;
    const path = draftPath(batch?.folder ?? safeFolder(this.folder()));
    const next = this.writes.catch(() => {}).then(() => this.storage.write(path, 'null\n'));
    this.writes = next;
    // Keep the review draft visible if clearing it fails.
    this.publish({ saving: true });
    try {
      await next;
      this.publish({ batch: undefined, job: undefined, error: undefined });
    } finally {
      this.publish({ saving: false });
    }
  }
  flush() {
    return this.writes;
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    this.listeners.clear();
  }
}
