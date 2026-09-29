import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCards, topicAtLine } from '../src/cards/parser';
import { CardIndex } from '../src/cards/card-index';
import { matchesSearch } from '../src/decks/deck-index';
const doc = (body: string, fm='qard-deck: Computer Networks') => `---\n${fm}\n---\n\n${body}`;
const card = '> [!qard]- What is TCP?\n> Reliable delivery.\n';
describe('Markdown cards', () => {
  it('indexes one deck in one file', () => { const c=parseCards(doc(card),'a.md').cards[0]!;expect(c.deck).toBe('Computer Networks');expect(c.frontMarkdown).toBe('What is TCP?');expect(c.topic).toBe('General'); });
  it('merges two source files into one logical deck', () => { const idx=new CardIndex();idx.update('a.md',doc(card));idx.update('b.md',doc(card.replace('TCP','UDP')));expect(idx.getSnapshot().decks).toHaveLength(1);expect(idx.getSnapshot().decks[0]?.cards).toHaveLength(2);expect(idx.getSnapshot().decks[0]?.files).toEqual(['a.md','b.md']); });
  it('uses nearest headings including nested and setext headings', () => { const result=parseCards(doc('# Transport\n'+card+'\n## Congestion\n'+card+'\nNetwork\n=======\n'+card),'a.md');expect(result.cards.map(c=>c.topic)).toEqual(['Transport','Congestion','Network']); });
  it('respects file-level topic override', () => { expect(parseCards(doc('# Ignored\n'+card,'qard-deck: Networks\nqard-topic: Fixed'),'a.md').cards[0]?.topic).toBe('Fixed'); });
  it('preserves multiline Markdown answers', () => { const c=parseCards(doc('> [!qard]- Lists?\n> **Bold**\n>\n> - one\n> - two\n>\n> ```ts\n> const n = 1;\n> ```'),'a.md').cards[0]!;expect(c.backMarkdown).toBe('**Bold**\n\n- one\n- two\n\n```ts\nconst n = 1;\n```'); });
  it('preserves image syntax and source path', () => { const c=parseCards(doc('> [!qard]- ![[front.png]]\n> ![[diagram.png|300]]\n>\n> ![alt](./image.png)'),'folder/a.md').cards[0]!;expect(c.frontMarkdown).toBe('![[front.png]]');expect(c.backMarkdown).toContain('![[diagram.png|300]]');expect(c.backMarkdown).toContain('![alt](./image.png)');expect(c.sourceFile).toBe('folder/a.md'); });
  it('preserves inline and block math exactly', () => { const latex='$$\nP(A|B) = \\frac{P(B|A)P(A)}{P(B)}\n$$';const c=parseCards(doc('> [!qard]- $E=mc^2$\n'+latex.split('\n').map(l=>'> '+l).join('\n')),'a.md').cards[0]!;expect(c.frontMarkdown).toBe('$E=mc^2$');expect(c.backMarkdown).toBe(latex); });
  it('detects unidentified handwritten cards without altering content', () => { const source=doc(card);const c=parseCards(source,'a.md').cards[0]!;expect(c.stable).toBe(false);expect(c.id).toMatch(/^volatile:/);expect(c.sourceText).toBe(card); });
  it('retains stable IDs through edits, moves and renames', () => { const source=doc('<!-- qard-id: stable-123 -->\n'+card);const original=parseCards(source,'a.md').cards[0]!;const moved=parseCards(source.replace('<!-- qard-id: stable-123 -->', '# Other\n<!-- qard-id: stable-123 -->').replace('TCP','UDP'),'renamed/a.md').cards[0]!;expect(original.id).toBe('stable-123');expect(moved.id).toBe(original.id);expect(moved.stable).toBe(true); });
  it('fails safely on malformed blocks and malformed YAML', () => { for(const source of ['---\nqard-deck: [oops\n---\n'+card,'---\nnot closed', '> [!qard]-\n> no question','> [!qard]- no answer','> [!qard]- bad code\n> ```\n> code']) { const result=parseCards(source,'a.md');expect(result.cards).toHaveLength(0);expect(result.issues.length).toBeGreaterThan(0); } });
  it('ignores callouts and headings in code fences or HTML comments', () => { const result=parseCards(doc('```md\n# Not a topic\n'+card+'```\n<!--\n'+card+'-->\n# Yes\n'+card),'a.md');expect(result.cards).toHaveLength(1);expect(result.cards[0]?.topic).toBe('Yes'); });
  it('does not split literal Qard syntax inside quoted code', () => { const result=parseCards(doc('> [!qard]- Syntax?\n> ```md\n> [!qard]- literal\n> <!-- qard-answer -->\n> ```'),'a.md');expect(result.cards).toHaveLength(1);expect(result.cards[0]?.backMarkdown).toContain('<!-- qard-answer -->'); });
  it('supports rich multiline fronts without changing the simple syntax', () => { const c=parseCards(doc('> [!qard]- Explain\n>\n> $$\n> E=mc^2\n> $$\n> <!-- qard-answer -->\n> Energy.'),'a.md').cards[0]!;expect(c.frontMarkdown).toBe('Explain\n\n$$\nE=mc^2\n$$');expect(c.backMarkdown).toBe('Energy.'); });
  it('separates adjacent Qard callouts', () => { expect(parseCards(card+card.replace('TCP','UDP'),'a.md').cards).toHaveLength(2); });
  it('keeps CRLF byte offsets and trailing text intact', () => { const source=('before\n\n'+card+'\nafter').replace(/\n/g,'\r\n');const c=parseCards(source,'a.md').cards[0]!;expect(source.slice(c.sourcePosition.start,c.sourcePosition.end)).toBe(c.sourceText);expect(c.sourcePosition.line).toBe(2); });
  it('indexes only changed files and removes renamed/deleted paths', () => {const idx=new CardIndex();idx.update('a.md',doc(card));idx.update('b.md',doc(card));idx.update('a.md',doc(card+card));expect(idx.getSnapshot().cards).toHaveLength(3);idx.remove('b.md');expect(idx.getSnapshot().cards).toHaveLength(2);});
  it('flags duplicate stable IDs across files', () => { const idx=new CardIndex();idx.update('a.md','<!-- qard-id: shared -->\n'+card);idx.update('b.md','<!-- qard-id: shared -->\n'+card);expect(idx.getSnapshot().cards.every(c=>c.duplicateId)).toBe(true);idx.remove('a.md');expect(idx.getSnapshot().cards[0]?.duplicateId).toBeUndefined(); });
  it('searches deck/topic/question/frontmatter and inline tags', () => { const c=parseCards(doc('# Transport\n'+card.replace('delivery.','delivery. #protocols'),'qard-deck: Networks\ntags: [exam]'),'a.md').cards[0]!;for(const query of ['Networks','Transport TCP','#exam','#protocols'])expect(matchesSearch(c,query)).toBe(true);expect(matchesSearch(c,'unrelated')).toBe(false); });
  it('the example vault merges both network notes', () => {const idx=new CardIndex();for(const file of ['networking-1.md','networking-2.md'])idx.update(file,readFileSync(new URL('../example-vault/Networks/'+file,import.meta.url),'utf8'));expect(idx.getSnapshot().decks).toHaveLength(1);expect(idx.getSnapshot().cards).toHaveLength(8);expect(idx.getSnapshot().issues).toHaveLength(0);});
});

it('resolves the topic at a heading before its first card and ignores fenced headings', () => {
  const source = '# First\n\n# Second\n```md\n# Fake\n```\n' + card;
  expect(topicAtLine(source, 'a.md', 2)).toBe('Second');
  expect(topicAtLine(source, 'a.md', 5)).toBe('Second');
  expect(topicAtLine(doc(source, 'qard-topic: Override'), 'a.md', 6)).toBe('Override');
});
