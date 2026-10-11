import { useRef, useState, type PointerEvent } from 'react';
import { ImagePlus, Undo2, Trash2 } from 'lucide-react';
import { IMAGE_EXTENSIONS, type ImageMask, type ImageOcclusion } from '../cards/card-format';
import { attachImage, imageResource } from '../cards/image-attachment';
import type { QardServices } from '../views/services';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
interface Gesture {
  pointer: number;
  start: { x: number; y: number };
  mode: 'draw' | 'move' | 'resize';
  original: ImageMask;
}
export function OcclusionEditor({
  value,
  change,
  services,
  path,
  uploading,
  setUploading,
  editing,
}: {
  value: ImageOcclusion;
  change: (value: ImageOcclusion) => void;
  services: QardServices;
  path: string;
  uploading: boolean;
  setUploading: (busy: boolean) => void;
  editing: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null),
    picker = useRef<HTMLInputElement>(null),
    gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<ImageMask | null>(null),
    [selected, setSelected] = useState<string>(),
    [filter, setFilter] = useState(''),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(''),
    [failed, setFailed] = useState('');
  const images = services.app.vault
    .getFiles()
    .filter((f) => IMAGE_EXTENSIONS.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  const src = value.image ? imageResource(services.app, value.image, path) : undefined;
  const ready = !!src && loaded === src && failed !== src;
  const chosen = value.masks.find((mask) => mask.id === selected);
  async function upload(file: File | undefined) {
    if (!file || uploading) {
      return;
    }
    setUploading(true);
    setError('');
    try {
      const image = await attachImage(services.app, file, path);
      change({ ...value, image });
      setLoaded('');
      setFailed('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (picker.current) {
        picker.current.value = '';
      }
    }
  }
  function position(event: PointerEvent) {
    const bounds = stage.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }
  function begin(event: PointerEvent, mode: Gesture['mode'], mask?: ImageMask) {
    if (
      !ready ||
      uploading ||
      (value.masks.length >= 100 && mode === 'draw') ||
      event.button !== 0 ||
      !event.isPrimary
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const start = position(event);
    const original = mask || {
      id: crypto.randomUUID(),
      x: start.x,
      y: start.y,
      width: 0,
      height: 0,
    };
    gesture.current = { pointer: event.pointerId, start, mode, original };
    setSelected(original.id);
    setDraft(original);
    stage.current!.setPointerCapture(event.pointerId);
  }
  function currentMask(event: PointerEvent): ImageMask | undefined {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) {
      return;
    }
    const point = position(event),
      { original, start, mode } = active;
    if (mode === 'draw') {
      return {
        ...original,
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      };
    }
    if (mode === 'move') {
      return {
        ...original,
        x: Math.max(0, Math.min(1 - original.width, original.x + point.x - start.x)),
        y: Math.max(0, Math.min(1 - original.height, original.y + point.y - start.y)),
      };
    }
    return {
      ...original,
      width: Math.max(0.005, Math.min(1 - original.x, original.width + point.x - start.x)),
      height: Math.max(0.005, Math.min(1 - original.y, original.height + point.y - start.y)),
    };
  }
  function end(event: PointerEvent, cancel = false) {
    const next = currentMask(event);
    if (!next) {
      return;
    }
    if (!cancel && next.width >= 0.005 && next.height >= 0.005) {
      const existing = value.masks.some((mask) => mask.id === next.id);
      change({
        ...value,
        masks: existing
          ? value.masks.map((mask) => (mask.id === next.id ? next : mask))
          : [...value.masks, next],
      });
    }
    gesture.current = null;
    setDraft(null);
    if (stage.current?.hasPointerCapture(event.pointerId)) {
      stage.current.releasePointerCapture(event.pointerId);
    }
  }
  function remove(id: string) {
    const masks = value.masks.filter((mask) => mask.id !== id);
    change({ ...value, masks, target: value.target === id ? masks[0]?.id : value.target });
    setSelected(undefined);
  }
  const masks = draft
    ? value.masks.some((mask) => mask.id === draft.id)
      ? value.masks.map((mask) => (mask.id === draft.id ? draft : mask))
      : [...value.masks, draft]
    : value.masks;
  return (
    <div className="qard-occlusion-editor">
      <div className="qard-image-picker">
        <label>
          Vault image
          <input
            type="search"
            aria-label="Find an image"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find an attachment…"
          />
          <select
            aria-label="Vault image"
            value={value.image}
            onChange={(e) => {
              change({ ...value, image: e.target.value });
              setLoaded('');
            }}
          >
            <option value="">Choose an image…</option>
            {images
              .filter(
                (f) =>
                  f.path === value.image || f.path.toLowerCase().includes(filter.toLowerCase()),
              )
              .map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            {value.image && !images.some((f) => f.path === value.image) && (
              <option value={value.image}>{value.image}</option>
            )}
          </select>
        </label>
        <button type="button" disabled={uploading} onClick={() => picker.current?.click()}>
          <ImagePlus size={16} />
          {uploading ? 'Adding image…' : 'Add image'}
        </button>
        <input
          ref={picker}
          className="qard-attachment-input"
          type="file"
          accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.avif"
          aria-label="Add image attachment"
          onChange={(e) => void upload(e.currentTarget.files?.[0])}
        />
      </div>
      <div
        className="qard-occlusion-workspace"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          void upload(e.dataTransfer.files[0]);
        }}
      >
        {src && failed !== src ? (
          <div
            ref={stage}
            className={'qard-occlusion-image qard-mask-canvas' + (ready ? ' is-ready' : '')}
            onPointerDown={(e) => begin(e, 'draw')}
            onPointerMove={(e) => {
              const next = currentMask(e);
              if (next) {
                setDraft(next);
              }
            }}
            onPointerUp={(e) => end(e)}
            onPointerCancel={(e) => end(e, true)}
          >
            <img
              src={src}
              alt="Draw masks over the parts you want to recall"
              draggable={false}
              onLoad={() => setLoaded(src)}
              onError={() => {
                setFailed(src);
                setLoaded('');
              }}
            />
            {ready &&
              masks.map((mask, index) => (
                <button
                  key={mask.id}
                  type="button"
                  aria-label={`Mask ${index + 1}`}
                  aria-pressed={selected === mask.id}
                  className={
                    'qard-image-mask qard-edit-mask' +
                    (selected === mask.id ? ' is-selected' : '') +
                    (value.target === mask.id ? ' is-target' : '')
                  }
                  style={{
                    left: `${mask.x * 100}%`,
                    top: `${mask.y * 100}%`,
                    width: `${mask.width * 100}%`,
                    height: `${mask.height * 100}%`,
                  }}
                  onClick={() => setSelected(mask.id)}
                  onPointerDown={(e) => begin(e, 'move', mask)}
                  onKeyDown={(e) => {
                    const delta = e.shiftKey ? 0.02 : 0.005;
                    if (
                      ![
                        'ArrowLeft',
                        'ArrowRight',
                        'ArrowUp',
                        'ArrowDown',
                        'Delete',
                        'Backspace',
                      ].includes(e.key)
                    ) {
                      return;
                    }
                    e.preventDefault();
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                      remove(mask.id);
                      return;
                    }
                    change({
                      ...value,
                      masks: value.masks.map((m) =>
                        m.id !== mask.id
                          ? m
                          : {
                              ...m,
                              x: Math.max(
                                0,
                                Math.min(
                                  1 - m.width,
                                  m.x +
                                    (e.key === 'ArrowLeft'
                                      ? -delta
                                      : e.key === 'ArrowRight'
                                        ? delta
                                        : 0),
                                ),
                              ),
                              y: Math.max(
                                0,
                                Math.min(
                                  1 - m.height,
                                  m.y +
                                    (e.key === 'ArrowUp'
                                      ? -delta
                                      : e.key === 'ArrowDown'
                                        ? delta
                                        : 0),
                                ),
                              ),
                            },
                      ),
                    });
                  }}
                >
                  <span>{index + 1}</span>
                  <span
                    className="qard-mask-handle"
                    aria-hidden="true"
                    onPointerDown={(e) => begin(e, 'resize', mask)}
                  />
                </button>
              ))}
          </div>
        ) : (
          <div className="qard-occlusion-empty">
            <ImagePlus size={28} />
            <strong>{value.image ? 'Image unavailable' : 'Choose or drop an image'}</strong>
            <p className="qard-muted">
              {value.image
                ? 'Restore the attachment or choose another image.'
                : 'Then drag over each label or detail you want to hide.'}
            </p>
          </div>
        )}
      </div>
      <div className="qard-format-tools">
        <span className="qard-muted">
          {value.masks.length} {value.masks.length === 1 ? 'mask' : 'masks'} · Drag to draw, move,
          or resize
        </span>
        <div className="qard-actions">
          <button
            type="button"
            disabled={!value.masks.length}
            onClick={() => remove(value.masks[value.masks.length - 1]!.id)}
          >
            <Undo2 size={14} />
            Undo last mask
          </button>
          <button type="button" disabled={!chosen} onClick={() => chosen && remove(chosen.id)}>
            <Trash2 size={14} />
            Remove selected
          </button>
        </div>
      </div>
      {chosen && (
        <div className="qard-mask-size">
          <span className="qard-muted">Selected mask</span>
          {(['width', 'height'] as const).map((dimension) => (
            <label key={dimension}>
              {dimension === 'width' ? 'Width (%)' : 'Height (%)'}
              <input
                type="number"
                min={0}
                max={100}
                step="any"
                value={Math.round(chosen[dimension] * 1000) / 10}
                onChange={(e) => {
                  const size = e.currentTarget.valueAsNumber / 100;
                  if (Number.isFinite(size)) {
                    change({
                      ...value,
                      masks: value.masks.map((mask) =>
                        mask.id === chosen.id
                          ? {
                              ...mask,
                              [dimension]: Math.max(
                                0.005,
                                Math.min(1 - mask[dimension === 'width' ? 'x' : 'y'], size),
                              ),
                            }
                          : mask,
                      ),
                    });
                  }
                }}
              />
            </label>
          ))}
        </div>
      )}
      {editing && value.target && (
        <label>
          Card's mask
          <select
            value={value.target}
            onChange={(e) => change({ ...value, target: e.target.value })}
          >
            {value.masks.map((mask, index) => (
              <option key={mask.id} value={mask.id}>
                Mask {index + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="qard-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
