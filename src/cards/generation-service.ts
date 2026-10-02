import { CANCELLED, runValidated, type AgentRunner } from '../agents/runner';
import { safeFolder, type CardWriter } from './card-writer';
import { flashcardPrompt } from './generation-prompts';
import { flashcardBatchSchema, flashcardsSchema, readDestination, readFlashcardBatch, readFlashcards, type FlashcardDestination, type GeneratedContent } from './generation-schema';
import { readCardFormat } from './card-format';

export interface FlashcardRequest { prompt: string; deck?: string; topic?: string; notes: string[]; folders?: string[]; format?: 'cloze' }
export interface GeneratedDraft extends GeneratedContent { id: string; selected: boolean; added: boolean }
interface Batch { id: string; folder: string; request: FlashcardRequest; cards: GeneratedDraft[]; destination?: FlashcardDestination; destinationLocked?: boolean }
export const flashcardDestination = (batch: Batch): FlashcardDestination => batch.destination ?? { deck: batch.request.deck ?? '', topic: batch.request.topic ?? '' };
export interface GenerationSnapshot { batch?: Batch; job?: { kind: 'flashcards'; startedAt: number; error?: string }; saving: boolean; error?: string; loading: boolean }
interface DraftStorage { read(path: string): Promise<string | null>; write(path: string, text: string): Promise<void> }
const draftPath = (folder: string) => [folder, 'Flashcard drafts.json'].filter(Boolean).join('/');
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

/** A background writer job with a durable review draft. Only approved cards reach the card writer. */
export class FlashcardGenerationService {
  private snapshot: GenerationSnapshot = { saving: false, loading: true };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private writes = Promise.resolve();
  private disposed = false;
  constructor(private storage: DraftStorage, private folder: () => string, private paths: () => string[], private runner: () => AgentRunner, private writer: Pick<CardWriter, 'createBatch'>, private notify: (text: string) => void = () => {}, private timing: (kind: string, ms: number) => void = () => {}, private destinations: () => { name: string; topics: string[] }[] = () => []) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<GenerationSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; if (!this.disposed) this.listeners.forEach(fn => fn()); }
  private persist() {
    const batch = this.snapshot.batch, path = draftPath(batch?.folder ?? safeFolder(this.folder()));
    const text = JSON.stringify(batch ?? null, null, 2) + '\n';
    const next = this.writes.catch(() => {}).then(() => this.storage.write(path, text));
    this.writes = next; return next;
  }
  async load() {
    try {
      const text = await this.storage.read(draftPath(safeFolder(this.folder())));
      if (!text || this.snapshot.batch || this.disposed) return;
      const value = JSON.parse(text) as Batch | null;
      if (!value) return;
      if (!/^[A-Za-z0-9_-]+$/.test(value.id) || safeFolder(value.folder) !== safeFolder(this.folder())) throw new Error('Invalid saved flashcard draft.');
      const request = this.validateRequest(value.request);
      if (!Array.isArray(value.cards)) throw new Error('Invalid saved flashcard draft.');
      // Drafts may be mid-edit; the writer validates content when the student adds them.
      if (value.cards.some(c => !c || !/^[A-Za-z0-9_-]+$/.test(c.id) || typeof c.front !== 'string' || typeof c.back !== 'string' || typeof c.source !== 'string' || typeof c.selected !== 'boolean' || typeof c.added !== 'boolean') || new Set(value.cards.map(c => c.id)).size !== value.cards.length) throw new Error('Invalid saved flashcard draft.');
      value.cards.forEach(c => { if (c.format) readCardFormat(c.format); });
      if (value.destination) readDestination(value.destination, false);
      if (value.destinationLocked !== undefined && typeof value.destinationLocked !== 'boolean') throw new Error('Invalid saved destination.');
      if (value.destinationLocked || value.cards.some(c => c.added)) readDestination(flashcardDestination(value));
      this.publish({ batch: { ...value, request }, job: value.cards.length ? undefined : { kind: 'flashcards', startedAt: Date.now(), error: 'Generation was interrupted. Try again when you are ready.' } });
    } catch (e) { this.publish({ error: `Could not restore flashcard drafts: ${message(e)}` }); }
    finally { this.publish({ loading: false }); }
  }
  private validateRequest(r: FlashcardRequest): FlashcardRequest {
    if (!r || typeof r.prompt !== 'string' || (r.deck !== undefined && typeof r.deck !== 'string') || (r.topic !== undefined && typeof r.topic !== 'string') || !Array.isArray(r.notes) || r.notes.some(p => typeof p !== 'string') || (r.folders !== undefined && (!Array.isArray(r.folders) || r.folders.some(p => typeof p !== 'string')))) throw new Error('Invalid flashcard request.');
    if (r.format !== undefined && r.format !== 'cloze') throw new Error('Invalid generated card type.');
    const { deck, topic } = readDestination({ deck: r.deck ?? '', topic: r.topic ?? '' }, false), prompt = r.prompt.trim();
    if (prompt.length > 10000) throw new Error('Keep the prompt under 10,000 characters.');
    if (!prompt && !r.notes.length) throw new Error('Describe the cards or choose at least one note.');
    const folders = r.folders?.map(safeFolder);
    return { prompt, ...(deck ? { deck } : {}), ...(topic ? { topic } : {}), notes: [...new Set(r.notes)], ...(folders?.length ? { folders: [...new Set(folders)] } : {}), ...(r.format ? { format: r.format } : {}) };
  }
  async start(request: FlashcardRequest) {
    if (this.snapshot.loading) throw new Error('Wait for saved drafts to load.');
    if (this.controller || this.snapshot.saving) throw new Error('Wait for the current flashcard job to finish.');
    const valid = this.validateRequest(request), available = this.paths();
    if (valid.notes.some(p => !available.includes(p))) throw new Error('A selected note no longer exists. Choose the notes again.');
    const batch: Batch = { id: crypto.randomUUID(), folder: safeFolder(this.folder()), request: valid, cards: [] };
    this.publish({ batch, job: undefined, error: undefined, saving: true });
    try { await this.persist(); }
    catch (e) { this.publish({ job: { kind: 'flashcards', startedAt: Date.now(), error: `Could not save the request: ${message(e)}` } }); throw e; }
    finally { this.publish({ saving: false }); }
    void this.generate();
  }
  async generate() {
    const batch = this.snapshot.batch;
    if (!batch || batch.cards.length || this.controller || this.snapshot.saving || this.disposed) return;
    const controller = new AbortController(), startedAt = Date.now(); this.controller = controller;
    this.publish({ error: undefined, job: { kind: 'flashcards', startedAt } });
    const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error(CANCELLED)), { once: true }));
    // Cancellation can happen while the request is still being persisted, before the provider race starts.
    cancelled.catch(() => {});
    try {
      await this.persist();
      if (controller.signal.aborted) throw new Error(CANCELLED);
      const paths = this.paths();
      if (batch.request.notes.some(p => !paths.includes(p))) throw new Error('A selected note no longer exists. Start a new batch and choose the notes again.');
      const infer = !batch.request.deck || !batch.request.topic;
      const result = await Promise.race([runValidated(this.runner(), { prompt: flashcardPrompt(batch.request, this.destinations()), schema: infer ? flashcardBatchSchema : flashcardsSchema, signal: controller.signal, effort: 'high' }, v => {
        if (!infer) return { destination: readDestination(flashcardDestination(batch)), cards: readFlashcards(v, paths, batch.request.format) };
        const generated = readFlashcardBatch(v, paths, batch.request.format);
        return { ...generated, destination: { deck: batch.request.deck || generated.destination.deck, topic: batch.request.topic || generated.destination.topic } };
      }), cancelled]);
      if (controller.signal.aborted || this.disposed) return;
      this.publish({ batch: { ...batch, destination: result.destination, cards: result.cards.map(c => ({ ...c, id: crypto.randomUUID(), selected: true, added: false })) } });
      await this.persist();
      if (this.disposed) return;
      this.publish({ job: undefined });
      this.timing('flashcards', Date.now() - startedAt); this.notify(`${result.cards.length} flashcards ready to review: ${result.destination.deck}`);
    } catch (e) { if (!this.disposed) this.publish({ job: { kind: 'flashcards', startedAt, error: controller.signal.aborted ? CANCELLED : message(e) } }); }
    finally { if (this.controller === controller) this.controller = undefined; }
  }
  cancel() { this.controller?.abort(); }
  updateDestination(patch: Partial<FlashcardDestination>) {
    const batch = this.snapshot.batch;
    if (!batch || !batch.cards.length || this.snapshot.saving || this.controller || batch.destinationLocked || batch.cards.some(c => c.added)) return;
    const destination = { ...flashcardDestination(batch), ...patch };
    try { readDestination(destination, false); } catch (e) { this.publish({ error: message(e) }); return; }
    this.publish({ batch: { ...batch, destination }, error: undefined });
    void this.persist().catch(e => this.publish({ error: `Could not save the destination: ${message(e)}` }));
  }
  updateCard(id: string, patch: Partial<Pick<GeneratedDraft, 'front' | 'back' | 'selected'>>) {
    const batch = this.snapshot.batch;
    if (!batch || this.snapshot.saving) return;
    this.publish({ batch: { ...batch, cards: batch.cards.map(c => c.id === id && !c.added ? { ...c, ...patch } : c) } });
    void this.persist().catch(e => this.publish({ error: `Could not save draft edits: ${message(e)}` }));
  }
  async addSelected() {
    const batch = this.snapshot.batch;
    if (!batch || this.snapshot.saving || this.controller) return;
    const cards = batch.cards.filter(c => c.selected && !c.added);
    if (!cards.length) return;
    this.publish({ saving: true, error: undefined });
    try {
      const destination = readDestination(flashcardDestination(batch));
      // A write may succeed before indexing fails. Freeze its destination before trying,
      // so changing the name cannot put the same batch in a second note on retry.
      const savingBatch = { ...batch, destination, destinationLocked: true };
      this.publish({ batch: savingBatch });
      await this.persist();
      await this.writer.createBatch({ ...destination, folder: batch.folder, batchId: batch.id }, cards);
      const ids = new Set(cards.map(c => c.id));
      this.publish({ batch: { ...savingBatch, cards: batch.cards.map(c => ids.has(c.id) ? { ...c, added: true } : c) } });
      await this.persist();
      this.notify(`${cards.length} flashcards added to ${destination.deck}`);
    } catch (e) { this.publish({ error: message(e) }); }
    finally { this.publish({ saving: false }); }
  }
  async clear() {
    if (this.controller || this.snapshot.saving) return;
    const batch = this.snapshot.batch;
    const path = draftPath(batch?.folder ?? safeFolder(this.folder()));
    const next = this.writes.catch(() => {}).then(() => this.storage.write(path, 'null\n'));
    this.writes = next;
    // Keep the review draft visible if clearing it fails.
    this.publish({ saving: true });
    try { await next; this.publish({ batch: undefined, job: undefined, error: undefined }); }
    finally { this.publish({ saving: false }); }
  }
  flush() { return this.writes; }
  dispose() { this.disposed = true; this.cancel(); this.listeners.clear(); }
}
