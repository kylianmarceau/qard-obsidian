import { useState } from 'react';
import { FORMAT_BACK, readCardFormat, renderCloze } from '../cards/card-format';
import { imageResource } from '../cards/image-attachment';
import type { QardServices } from '../views/services';
import { Markdown } from './Markdown';

export function CardContent({
  front,
  back,
  path,
  services,
  revealed,
}: {
  front: string;
  back?: string;
  path: string;
  services: QardServices;
  revealed: boolean;
}) {
  const format = readCardFormat(front);
  const [failedImage, setFailedImage] = useState('');
  if (format.kind === 'basic') {
    return (
      <Markdown
        text={revealed && back !== undefined ? back : front}
        path={path}
        services={services}
      />
    );
  }
  const image = format.kind === 'occlusion' ? format.occlusion.image : '';
  const src = image ? imageResource(services.app, image, path) : undefined;
  return (
    <div className={'qard-format-content qard-format-' + format.kind}>
      <Markdown
        text={
          format.kind === 'cloze' ? renderCloze(format.text, format.target, revealed) : format.text
        }
        path={path}
        services={services}
      />
      {format.kind === 'occlusion' &&
        (src && failedImage !== src ? (
          <div className="qard-occlusion-image">
            <img
              src={src}
              alt="Study diagram"
              draggable={false}
              onError={() => setFailedImage(src)}
            />
            {format.occlusion.masks.map((mask, index) => {
              const active = !format.occlusion.target || format.occlusion.target === mask.id;
              return (
                <span
                  key={mask.id}
                  className={
                    'qard-image-mask' +
                    (active ? ' is-active' : '') +
                    (revealed && active ? ' is-answer' : '')
                  }
                  aria-label={
                    revealed && active
                      ? `Revealed region ${index + 1}`
                      : `Hidden region ${index + 1}`
                  }
                  style={{
                    left: `${mask.x * 100}%`,
                    top: `${mask.y * 100}%`,
                    width: `${mask.width * 100}%`,
                    height: `${mask.height * 100}%`,
                  }}
                />
              );
            })}
          </div>
        ) : (
          <p className="qard-error" role="alert">
            Image unavailable: {image}. Restore its attachment or edit the card to choose another
            image.
          </p>
        ))}
      {revealed && back && back !== FORMAT_BACK && (
        <div className="qard-format-notes">
          <Markdown text={back} path={path} services={services} />
        </div>
      )}
    </div>
  );
}
