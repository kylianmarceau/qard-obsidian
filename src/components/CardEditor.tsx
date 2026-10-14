import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Scope } from 'obsidian';
import { ArrowLeftRight, Check, Sparkles, Layers, TextCursorInput, Scan } from 'lucide-react';
import {
  clozeFront,
  clozeGroups,
  FORMAT_BACK,
  occlusionFront,
  readCardFormat,
  type ImageOcclusion,
} from '../cards/card-format';
import type { QardCard } from '../cards/card-types';
import type { CardDraft } from '../cards/card-writer';
import type { QardServices } from '../views/services';
import { Markdown } from './Markdown';
import { ClozeEditor } from './ClozeEditor';
import { OcclusionEditor } from './OcclusionEditor';
import { CardContent } from './CardContent';
type FormatKind = ReturnType<typeof readCardFormat>['kind'];
/** The last card type, deck and topic you created with, kept while Obsidian is open. */
let remembered: { kind: FormatKind; reverse: boolean; deck?: string; topic?: string } = {
  kind: 'basic',
  reverse: false,
};
export function forgetEditorChoices() {
  remembered = { kind: 'basic', reverse: false };
}
const CARD_TYPES = [
  { type: 'basic', label: 'Basic', icon: Layers },
  { type: 'reverse', label: 'Basic + reverse', icon: ArrowLeftRight },
  { type: 'cloze', label: 'Cloze', icon: TextCursorInput },
  { type: 'occlusion', label: 'Image occlusion', icon: Scan },
] as const;
const OCCLUSION_PROMPT = 'Identify the hidden part.';
export function CardEditor({
  services,
  card,
  initial,
  cancel,
  saved,
  compact = false,
  generate,
  addAnother,
  cancelLabel = 'Cancel',
  focusFront = false,
  prefill,
}: {
  services: QardServices;
  card?: QardCard;
  initial?: Partial<CardDraft>;
  cancel: () => void;
  saved: (card: QardCard) => void;
  compact?: boolean;
  generate?: (draft: Partial<CardDraft>) => void;
  /** When creating, each save starts a new card with the same deck and topic. */
  addAnother?: (next: Partial<CardDraft>, card: QardCard) => void;
  /** "Done" once cards were added in this run; "Cancel" before. */
  cancelLabel?: string;
  focusFront?: boolean;
  /** A new serial moves the editor to this deck and topic without clearing what you typed. */
  prefill?: { serial: number; deck: string; topic: string; sourceFile?: string };
}) {
  const fresh = !card && !initial?.front;
  const continuous = !!addAnother && !card;
  const original = readCardFormat(card?.frontMarkdown || initial?.front || '');
  const batch = useRef({
    id: crypto.randomUUID(),
    ids: new Map<string, string>(),
    path: undefined as string | undefined,
  });
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const written = useRef<{ card: QardCard; front: string; back: string } | undefined>(undefined);
  const [kind, setKind] = useState<FormatKind>(fresh ? remembered.kind : original.kind);
  const [reverse, setReverse] = useState(
    card ? !!card.reverseId : (initial?.reverse ?? (fresh && remembered.reverse)),
  );
  const [front, setFront] = useState(
      kind === 'occlusion' && !original.text ? OCCLUSION_PROMPT : original.text,
    ),
    [back, setBack] = useState(
      original.kind !== 'basic' && card?.backMarkdown === FORMAT_BACK
        ? ''
        : card?.backMarkdown || initial?.back || '',
    );
  const [occlusion, setOcclusion] = useState<ImageOcclusion>(
    original.kind === 'occlusion' ? original.occlusion : { image: '', masks: [] },
  );
  const [uploading, setUploading] = useState(false),
    [oneAtATime, setOneAtATime] = useState(true),
    [previewTarget, setPreviewTarget] = useState<number>(),
    [previewMask, setPreviewMask] = useState<string>();
  const startDeck = card?.deck || initial?.deck || remembered.deck || '';
  const [deck, setDeck] = useState(startDeck),
    [topic, setTopic] = useState(
      card?.topic ||
        initial?.topic ||
        (startDeck === remembered.deck ? remembered.topic : undefined) ||
        'General',
    ),
    [sourceFile, setSourceFile] = useState(initial?.sourceFile);
  // Only a newer request moves the editor; the one it opened with is already in `initial`.
  const prefilled = useRef(prefill?.serial);
  useEffect(() => {
    if (prefill && prefill.serial !== prefilled.current) {
      prefilled.current = prefill.serial;
      setDeck(prefill.deck);
      setTopic(prefill.topic);
      setSourceFile(prefill.sourceFile);
    }
  }, [prefill?.serial]);
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const index = useSyncExternalStore(services.index.subscribe, services.index.getSnapshot);
  const cardFolder = services.reviews.getSnapshot().settings.cardFolder;
  // Where a new card will be saved, shown before saving.
  const destination = useMemo(() => {
    if (card || !deck.trim() || /[\r\n]/.test(deck + topic)) {
      return undefined;
    }
    try {
      return services.writer.targetFor(deck, topic, cardFolder, sourceFile);
    } catch {
      return undefined;
    }
    // The index revision covers notes that were added, changed or removed.
  }, [card, deck, topic, cardFolder, sourceFile, index.revision, services.writer]);
  const id = useId(),
    path = card?.sourceFile || destination?.path || sourceFile || `${cardFolder}/Cards.md`;
  const groups = kind === 'cloze' ? clozeGroups(front) : [];
  const target =
    original.kind === 'cloze'
      ? original.target
      : previewTarget && groups.includes(previewTarget)
        ? previewTarget
        : groups[0] || 1;
  const encodedFront =
    kind === 'basic'
      ? front
      : kind === 'cloze'
        ? clozeFront(front, target)
        : occlusionFront(
            front,
            card
              ? occlusion
              : {
                  ...occlusion,
                  target: oneAtATime
                    ? occlusion.masks.find((mask) => mask.id === previewMask)?.id ||
                      occlusion.masks[0]?.id
                    : undefined,
                },
          );
  let previewError = '';
  try {
    readCardFormat(encodedFront);
  } catch (e) {
    previewError = (e as Error).message;
  }
  const count = card
    ? 1
    : kind === 'cloze'
      ? groups.length
      : kind === 'occlusion' && oneAtATime
        ? occlusion.masks.length
        : reverse
          ? 2
          : 1;
  const shortcut = useRef(() => {});
  shortcut.current = () => {
    if (!busy) {
      submitWith(continuous ? 'another' : 'done');
    }
  };
  // Obsidian binds Mod+Enter to opening links in a new tab and handles it before the page sees
  // it, so the editor claims it through a keymap scope while focus is inside the form.
  useEffect(() => {
    const el = form.current,
      keymap = services.app?.keymap;
    if (!el || !keymap) {
      return;
    }
    const scope = new Scope(services.app.scope);
    scope.register(['Mod'], 'Enter', () => {
      shortcut.current();
      return false;
    });
    let pushed = false;
    const enter = () => {
      if (!pushed) {
        keymap.pushScope(scope);
        pushed = true;
      }
    };
    const leave = (event: FocusEvent) => {
      if (pushed && !el.contains(event.relatedTarget as Node | null)) {
        keymap.popScope(scope);
        pushed = false;
      }
    };
    el.addEventListener('focusin', enter);
    el.addEventListener('focusout', leave);
    if (el.contains(el.ownerDocument.activeElement)) {
      enter();
    }
    return () => {
      el.removeEventListener('focusin', enter);
      el.removeEventListener('focusout', leave);
      if (pushed) {
        keymap.popScope(scope);
      }
    };
  }, [services.app]);
  /** Validate like a normal submit, for the second button and Mod+Enter. */
  function submitWith(mode: 'done' | 'another') {
    if (form.current?.reportValidity() !== false) {
      void submit(mode);
    }
  }
  function created(result: QardCard, mode: 'done' | 'another') {
    remembered = {
      kind,
      reverse: kind === 'basic' && reverse,
      deck: deck.trim(),
      topic: topic.trim(),
    };
    if (mode === 'another' && addAnother) {
      addAnother({ deck: deck.trim(), topic: topic.trim(), sourceFile }, result);
    } else {
      saved(result);
    }
  }
  async function submit(mode: 'done' | 'another' = 'done') {
    if (submitting.current) {
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      readCardFormat(encodedFront);
      if (kind === 'occlusion' && !occlusion.image) {
        throw new Error('Choose an image first.');
      }
      const answer = kind === 'basic' ? back : back.trim() || FORMAT_BACK;
      const variants =
        kind === 'cloze' && !card
          ? groups.map((group) => clozeFront(front, group))
          : kind === 'occlusion' && !card && oneAtATime
            ? occlusion.masks.map((mask) =>
                occlusionFront(front, { ...occlusion, target: mask.id }),
              )
            : [encodedFront];
      if (!variants.length) {
        throw new Error('Add a blank or an image mask before saving.');
      }
      if (!card && kind !== 'basic') {
        const folder = sourceFile ? sourceFile.split('/').slice(0, -1).join('/') : cardFolder;
        // Fixed on the first try, so a retry can't land in another note.
        batch.current.path ??= services.writer.targetFor(deck, topic, cardFolder, sourceFile).path;
        const result = await services.writer.createBatch(
          {
            deck,
            topic,
            folder,
            batchId: batch.current.id,
            label: kind === 'cloze' ? 'cloze' : 'occlusion',
            siblingGroup: batch.current.id,
            path: batch.current.path,
          },
          variants.map((value) => {
            const format = readCardFormat(value);
            const key =
              format.kind === 'cloze'
                ? `cloze-${format.target}`
                : format.kind === 'occlusion'
                  ? `image-${format.occlusion.target || 'all'}`
                  : 'basic';
            let identity = batch.current.ids.get(key);
            if (!identity) {
              identity = crypto.randomUUID();
              batch.current.ids.set(key, identity);
            }
            return { id: identity, front: value, back: answer };
          }),
        );
        created(result[0]!, mode);
        return;
      }
      const result = card
        ? written.current?.front === encodedFront && written.current.back === answer
          ? written.current.card
          : await services.writer.edit(written.current?.card ?? card, encodedFront, answer)
        : await services.writer.create({
            deck,
            topic,
            front: variants[0]!,
            back: answer,
            folder: cardFolder,
            sourceFile,
            reverse: kind === 'basic' && reverse,
          });
      if (card) {
        written.current = { card: result, front: encodedFront, back: answer };
        if (card.frontMarkdown !== encodedFront || card.backMarkdown !== answer) {
          await services.reviews.requireContentCheck(result.id);
          if (result.reverseId) {
            await services.reviews.requireContentCheck(result.reverseId);
          }
        }
        saved(result);
      } else {
        created(result, mode);
      }
    } catch (e) {
      submitting.current = false;
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className={'qard-editor ' + (compact ? 'qard-editor-compact' : '')}>
      <div className="qard-heading">
        <h1>{card ? 'Edit card' : 'New card'}</h1>
        {!card && generate && (
          <button
            disabled={busy}
            type="button"
            onClick={() => generate({ deck, topic, sourceFile })}
          >
            <Sparkles size={16} />
            Generate with AI
          </button>
        )}
      </div>
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(continuous ? 'another' : 'done');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            shortcut.current();
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="qard-card-type" role="group" aria-label="Card type">
            {CARD_TYPES.map((item) => {
              const format = item.type === 'reverse' ? 'basic' : item.type;
              const pressed =
                kind === format && (format !== 'basic' || reverse === (item.type === 'reverse'));
              return (
                <button
                  key={item.type}
                  type="button"
                  aria-pressed={pressed}
                  disabled={(!!card && !pressed) || uploading}
                  onClick={() => {
                    setKind(format);
                    setReverse(item.type === 'reverse');
                    setPreview(false);
                    if (format === 'occlusion' && !front.trim()) {
                      setFront(OCCLUSION_PROMPT);
                    } else if (format !== 'occlusion' && front.trim() === OCCLUSION_PROMPT) {
                      // The image prompt is a placeholder, not a question for other card types.
                      setFront('');
                    }
                  }}
                >
                  <item.icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="qard-editor-meta">
            <label>
              Deck
              <input
                required
                value={deck}
                readOnly={!!card}
                onChange={(e) => setDeck(e.target.value)}
                list={id + '-decks'}
                placeholder="e.g. Computer Networks"
                maxLength={200}
              />
            </label>
            <datalist id={id + '-decks'}>
              {services.index.getSnapshot().decks.map((d) => (
                <option key={d.name} value={d.name} />
              ))}
            </datalist>
            <label>
              Topic
              <input
                required
                value={topic}
                readOnly={!!card}
                onChange={(e) => setTopic(e.target.value)}
                list={id + '-topics'}
                placeholder="e.g. Transport Layer"
                maxLength={200}
              />
            </label>
            <datalist id={id + '-topics'}>
              {index.decks
                .find((d) => d.name === deck.trim())
                ?.topics.map((t) => (
                  <option key={t.name} value={t.name} />
                ))}
            </datalist>
          </div>
          {card && <p className="qard-muted">To change deck or topic, edit the source note.</p>}
          {kind === 'basic' ? (
            <div className="qard-editor-sides">
              <label>
                Front
                <textarea
                  required
                  autoFocus={focusFront}
                  value={front}
                  onChange={(e) => setFront(e.target.value)}
                  rows={compact ? 3 : 5}
                  placeholder="Question…"
                />
              </label>
              <label>
                Back
                <textarea
                  required
                  value={back}
                  onChange={(e) => setBack(e.target.value)}
                  rows={compact ? 5 : 7}
                  placeholder="Answer…"
                />
              </label>
            </div>
          ) : (
            <div className="qard-editor-sides">
              {kind === 'cloze' ? (
                <ClozeEditor text={front} change={setFront} />
              ) : (
                <>
                  <label>
                    Question
                    <input
                      value={front}
                      onChange={(e) => setFront(e.target.value)}
                      placeholder="Identify the hidden part."
                    />
                  </label>
                  <OcclusionEditor
                    value={occlusion}
                    change={setOcclusion}
                    services={services}
                    path={path}
                    uploading={uploading}
                    setUploading={setUploading}
                    editing={!!card}
                  />
                  {!card && (
                    <label className="qard-mask-mode">
                      <input
                        type="checkbox"
                        checked={oneAtATime}
                        onChange={(e) => setOneAtATime(e.target.checked)}
                      />
                      One card per mask
                      <span>
                        Reveal one region at a time. Turn off to recall all regions together.
                      </span>
                    </label>
                  )}
                </>
              )}
              <label>
                Extra notes <span className="qard-muted">Optional · shown after reveal</span>
                <textarea
                  value={back}
                  onChange={(e) => setBack(e.target.value)}
                  rows={3}
                  placeholder="Add context or an explanation…"
                />
              </label>
            </div>
          )}
          {kind === 'basic' && reverse && !card && !compact && (
            <p className="qard-muted qard-small">
              Creates a linked pair: front → back and back → front, each with its own schedule.
            </p>
          )}
          {card?.reverseId && (
            <p className="qard-muted qard-small">
              Linked reverse pair · edits update both directions and preserve their review
              histories.
            </p>
          )}
          {preview && kind !== 'basic' && !card && groups.length > 1 && (
            <div className="qard-format-tools">
              {groups.map((group) => (
                <button
                  type="button"
                  key={group}
                  aria-pressed={target === group}
                  onClick={() => setPreviewTarget(group)}
                >
                  Blank {group}
                </button>
              ))}
            </div>
          )}
          {preview && kind === 'occlusion' && !card && oneAtATime && occlusion.masks.length > 1 && (
            <div className="qard-format-tools">
              {occlusion.masks.map((mask, index) => (
                <button
                  type="button"
                  key={mask.id}
                  aria-pressed={(previewMask || occlusion.masks[0]?.id) === mask.id}
                  onClick={() => setPreviewMask(mask.id)}
                >
                  Mask {index + 1}
                </button>
              ))}
            </div>
          )}
          {preview &&
            (previewError ? (
              <p className="qard-muted" role="status">
                {previewError}
              </p>
            ) : (
              <div className="qard-editor-rendered">
                <div>
                  <span className="qard-eyebrow">FRONT</span>
                  {kind === 'basic' ? (
                    <Markdown text={front} path={path} services={services} />
                  ) : (
                    <CardContent
                      front={encodedFront}
                      path={path}
                      services={services}
                      revealed={false}
                    />
                  )}
                </div>
                <div>
                  <span className="qard-eyebrow">BACK</span>
                  {kind === 'basic' ? (
                    <Markdown text={back} path={path} services={services} />
                  ) : (
                    <CardContent
                      front={encodedFront}
                      back={back}
                      path={path}
                      services={services}
                      revealed={true}
                    />
                  )}
                </div>
              </div>
            ))}
          {!compact && (
            <p className="qard-muted qard-editor-destination">
              {card
                ? card.sourceFile
                : destination
                  ? destination.exists
                    ? `Adds to ${destination.path} › ${topic.trim() || 'General'}`
                    : `Creates ${destination.path}`
                  : `Folder: ${cardFolder || 'vault root'}`}
            </p>
          )}
          {error && (
            <p role="alert" className="qard-error">
              {error}
            </p>
          )}
          <div className="qard-form-actions">
            <button
              type="button"
              className="qard-form-actions-start"
              aria-expanded={preview}
              onClick={() => setPreview(!preview)}
            >
              {preview ? 'Hide' : 'Show'} preview
            </button>
            <button type="button" disabled={!!written.current && !!error} onClick={cancel}>
              {cancelLabel}
            </button>
            <button
              className="qard-primary"
              type="submit"
              disabled={uploading}
              title={card ? undefined : 'Ctrl/Cmd + Enter'}
            >
              <Check size={17} />
              {busy
                ? 'Saving…'
                : card
                  ? 'Save changes'
                  : continuous
                    ? count > 1
                      ? `Add ${count} cards`
                      : 'Add card'
                    : count > 1
                      ? `Create ${count} cards`
                      : 'Create card'}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
