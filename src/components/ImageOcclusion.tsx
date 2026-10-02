import { useState, type PointerEvent } from 'react';
import { TFile } from 'obsidian';
import type { ImageMask } from '../cards/card-types';
import type { QardServices } from '../views/services';

export const imageExtensions = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i;
export function ImageOcclusion({ image, masks, path, services, revealed = false, addMask }: {
  image: string; masks: ImageMask[]; path: string; services: QardServices; revealed?: boolean; addMask?: (mask: ImageMask) => void;
}) {
  const [drag, setDrag] = useState<{ pointerId: number; start: { x: number; y: number }; end: { x: number; y: number } }>();
  const [failed, setFailed] = useState('');
  const file = services.app.metadataCache.getFirstLinkpathDest(image, path);
  if (!(file instanceof TFile) || !imageExtensions.test(file.path)) return <p role="alert" className="qard-error">Image not found in this vault: {image}</p>;
  if (failed === image) return <p role="alert" className="qard-error">Could not display {image}. Check the attachment in your vault.</p>;
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const percent = (value: number) => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
    return { x: percent((event.clientX - rect.left) / rect.width * 100), y: percent((event.clientY - rect.top) / rect.height * 100) };
  };
  const rectangle = (start: { x: number; y: number }, end: { x: number; y: number }): ImageMask => ({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.round(Math.abs(start.x - end.x) * 100) / 100, height: Math.round(Math.abs(start.y - end.y) * 100) / 100 });
  const visible = drag ? [...masks, rectangle(drag.start, drag.end)] : masks;
  return <div className={'qard-occlusion' + (addMask ? ' is-editable' : '')} aria-label={addMask ? 'Drag over the image to hide a region' : revealed ? 'Image with hidden regions revealed' : 'Image with covered regions'}
    onPointerDown={event => {
      if (!addMask || drag || event.button !== 0 || masks.length >= 100) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      const start = point(event); setDrag({ pointerId: event.pointerId, start, end: start });
    }}
    onPointerMove={event => { if (drag && drag.pointerId === event.pointerId) setDrag({ ...drag, end: point(event) }); }}
    onPointerUp={event => {
      if (!drag || drag.pointerId !== event.pointerId || !addMask) return;
      const mask = rectangle(drag.start, point(event)); setDrag(undefined);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (mask.width >= 1 && mask.height >= 1) addMask(mask);
    }} onPointerCancel={() => setDrag(undefined)} onLostPointerCapture={() => setDrag(undefined)}>
    <img key={image} src={services.app.vault.getResourcePath(file)} alt="Study diagram" draggable={false} onError={() => setFailed(image)}/>
    {!revealed && visible.map((mask, i) => <span key={i} className="qard-image-mask" aria-label={`Hidden region ${i + 1}`} style={{ left: `${mask.x}%`, top: `${mask.y}%`, width: `${mask.width}%`, height: `${mask.height}%` }}>{i + 1}</span>)}
  </div>;
}
