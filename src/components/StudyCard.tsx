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
  // Keep both faces mounted so embeds are ready when the card turns. The hidden
  // face is inert and excluded from the accessibility tree, including its links.
  return (
    <div className="qard-study-stage">
      <div className={'qard-study-card' + (revealed ? ' is-revealed' : '')}>
        <article
          className="qard-study-face qard-study-front"
          aria-hidden={revealed}
          inert={revealed}
        >
          <div className="qard-study-question">
            <CardContent
              front={card.frontMarkdown}
              path={card.sourceFile}
              services={services}
              revealed={false}
            />
          </div>
        </article>
        <article
          className="qard-study-face qard-study-back"
          aria-hidden={!revealed}
          inert={!revealed}
        >
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
        </article>
      </div>
    </div>
  );
}
