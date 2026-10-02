import type { CardFormat } from '../cards/card-types';
import { clozeMarkdown } from '../cards/card-format';
import type { QardServices } from '../views/services';
import { Markdown } from './Markdown';
import { ImageOcclusion } from './ImageOcclusion';

/** Shared by study, the editor, and previews so hidden content behaves consistently. */
export function CardContent({ front, back, format, revealed, path, services }: {
  front: string; back: string; format?: CardFormat; revealed: boolean; path: string; services: QardServices;
}) {
  return <>
    <Markdown text={format?.type === 'cloze' ? clozeMarkdown(front, revealed) : front} path={path} services={services}/>
    {format?.type === 'occlusion' && <ImageOcclusion image={format.image} masks={format.masks} revealed={revealed} path={path} services={services}/>}
    {revealed && back && <div className="qard-study-answer"><Markdown text={back} path={path} services={services}/></div>}
  </>;
}
