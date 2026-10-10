import { useState, useId, useRef, type SyntheticEvent } from 'react';
import { Check, Sparkles, Layers, TextCursorInput, Scan } from 'lucide-react';
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
export function CardEditor({
  services,
  card,
  initial,
  cancel,
  saved,
  compact = false,
  generate,
}: {
  services: QardServices;
  card?: QardCard;
  initial?: Partial<CardDraft>;
  cancel: () => void;
  saved: (card: QardCard) => void;
  compact?: boolean;
  generate?: (draft: Partial<CardDraft>) => void;
}) {
  const original = readCardFormat(card?.frontMarkdown || initial?.front || '');
  const batch = useRef({ id: crypto.randomUUID(), ids: new Map<string, string>() });
  const submitting = useRef(false);
  const written = useRef<{ card: QardCard; front: string; back: string } | undefined>(undefined);
  const [kind, setKind] = useState(original.kind);
  const [reverse, setReverse] = useState(initial?.reverse ?? false);
  const [front, setFront] = useState(original.text),
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
  const [deck, setDeck] = useState(card?.deck || initial?.deck || ''),
    [topic, setTopic] = useState(card?.topic || initial?.topic || 'General');
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const id = useId(),
    path =
      card?.sourceFile ||
      initial?.sourceFile ||
      `${services.reviews.getSnapshot().settings.cardFolder}/Cards.md`;
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
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
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
        const folder = initial?.sourceFile
          ? initial.sourceFile.split('/').slice(0, -1).join('/')
          : services.reviews.getSnapshot().settings.cardFolder;
        const created = await services.writer.createBatch(
          {
            deck,
            topic,
            folder,
            batchId: batch.current.id,
            label: kind === 'cloze' ? 'cloze' : 'occlusion',
            siblingGroup: batch.current.id,
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
        saved(created[0]!);
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
            folder: services.reviews.getSnapshot().settings.cardFolder,
            sourceFile: initial?.sourceFile,
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
      }
      saved(result);
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
            onClick={() => generate({ deck, topic, sourceFile: initial?.sourceFile })}
          >
            <Sparkles size={16} />
            Generate with AI
          </button>
        )}
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          <div className="qard-card-type" role="group" aria-label="Card type">
            {(
              [
                { kind: 'basic', label: 'Basic', icon: Layers },
                { kind: 'cloze', label: 'Cloze', icon: TextCursorInput },
                { kind: 'occlusion', label: 'Image occlusion', icon: Scan },
              ] as const
            ).map((item) => (
              <button
                key={item.kind}
                type="button"
                aria-pressed={kind === item.kind}
                disabled={(!!card && kind !== item.kind) || uploading}
                onClick={() => {
                  setKind(item.kind);
                  setPreview(false);
                  if (item.kind === 'occlusion' && !front.trim()) {
                    setFront('Identify the hidden part.');
                  }
                }}
              >
                <item.icon size={15} />
                {item.label}
              </button>
            ))}
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
                placeholder="e.g. Transport Layer"
                maxLength={200}
              />
            </label>
          </div>
          {card && <p className="qard-muted">To change deck or topic, edit the source note.</p>}
          {kind === 'basic' ? (
            <div className="qard-editor-sides">
              <label>
                Front
                <textarea
                  required
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
          {kind === 'basic' && !card && (
            <label className="qard-reverse-toggle">
              <input
                type="checkbox"
                checked={reverse}
                onChange={(event) => setReverse(event.target.checked)}
              />
              Also test the reverse
              <span className="qard-muted qard-small">
                Creates a linked pair with a separate schedule for each direction.
              </span>
            </label>
          )}
          {card?.reverseId && (
            <p className="qard-muted qard-small">
              Linked reverse pair · edits update both directions and preserve their review
              histories.
            </p>
          )}
          <button type="button" aria-expanded={preview} onClick={() => setPreview(!preview)}>
            {preview ? 'Hide' : 'Show'} preview
          </button>
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
          <p className="qard-muted">
            {initial?.sourceFile
              ? `Source: ${initial.sourceFile}`
              : card
                ? card.sourceFile
                : `Folder: ${services.reviews.getSnapshot().settings.cardFolder || 'vault root'}`}
          </p>
          {error && (
            <p role="alert" className="qard-error">
              {error}
            </p>
          )}
          <div className="qard-form-actions">
            <button type="button" disabled={!!written.current && !!error} onClick={cancel}>
              Cancel
            </button>
            <button className="qard-primary" type="submit" disabled={uploading}>
              <Check size={17} />
              {busy
                ? 'Saving…'
                : card
                  ? 'Save changes'
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
