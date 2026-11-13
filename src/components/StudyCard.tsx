import type { QardCard } from '../cards/card-types';
import type { QardServices } from '../views/services';
import { Markdown } from './Markdown';
import { readCardFormat } from '../cards/card-format';
import { CardContent } from './CardContent';

export function StudyCard({
  card,
  revealed,
  services,
}: {
  card: QardCard;
  revealed: boolean;
  services: QardServices;
}) {
  const special = readCardFormat(card.frontMarkdown).kind !== 'basic';
  // Keep the face containers stable, but render their content only while visible:
  // Markdown embeds such as Mermaid need measurable DOM during their initial render.
  return (
    <div className="qard-study-stage">
      <div className={'qard-study-card' + (revealed ? ' is-revealed' : '')}>
        <article
          className="qard-study-face qard-study-front"
          aria-hidden={revealed}
          inert={revealed}
        >
          <div className="qard-study-question">
            {!revealed && (
              <CardContent
                front={card.frontMarkdown}
                path={card.sourceFile}
                services={services}
                revealed={false}
              />
            )}
          </div>
        </article>
        <article
          className={'qard-study-face qard-study-back' + (special ? '' : ' is-basic')}
          aria-hidden={!revealed}
          inert={!revealed}
        >
          {revealed && (
            <>
              <div className="qard-study-question">
                <CardContent
                  front={card.frontMarkdown}
                  back={special ? card.backMarkdown : undefined}
                  path={card.sourceFile}
                  services={services}
                  revealed={special}
                />
              </div>
              {!special && (
                <div className="qard-study-answer">
                  <Markdown text={card.backMarkdown} path={card.sourceFile} services={services} />
                </div>
              )}
            </>
          )}
        </article>
      </div>
    </div>
  );
}
