import { it, expect } from 'vitest';
import { parseCards } from '../src/cards/parser';
import { ensureIdInSource, replaceCardInSource, deleteCardInSource, deleteGroupInSource, serializeCard } from '../src/cards/source-patch';
const block='> [!qard]- Question?\n> Answer.\n';
it('assigns only an adjacent ID without rewriting existing content',()=>{const source='Intro  \n\n'+block+'\nOutro\n';const original=parseCards(source,'a.md').cards[0]!;const result=ensureIdInSource(source,original,'stable');expect(result.source).toBe('Intro  \n\n<!-- qard-id: stable -->\n'+block+'\nOutro\n');expect(result.card.id).toBe('stable');});
it('missing ID assignment preserves CRLF',()=>{const source=block.replace(/\n/g,'\r\n');expect(ensureIdInSource(source,parseCards(source,'a.md').cards[0]!,'stable').source).toBe('<!-- qard-id: stable -->\r\n'+source);});
it('edits the chosen card and preserves every surrounding byte',()=>{const source='<!-- qard-id: first -->\n'+block+'\n# untouched  \n<!-- qard-id: second -->\n'+block;const c=parseCards(source,'a.md').cards[1]!;const edited=replaceCardInSource(source,c,'Changed?','**Answer**','second');expect(edited.slice(0,c.sourcePosition.start)).toBe(source.slice(0,c.sourcePosition.start));expect(parseCards(edited,'a.md').cards[1]?.id).toBe('second');});
it('finds a stable card when unrelated text shifts its line number',()=>{const source='<!-- qard-id: first -->\n'+block;const c=parseCards(source,'a.md').cards[0]!;expect(replaceCardInSource('new intro\n'+source,c,'Edited?','New','first')).toContain('new intro\n<!-- qard-id: first -->');});
it('refuses to overwrite edits made after the editor opened',()=>{const source='<!-- qard-id: first -->\n'+block;const c=parseCards(source,'a.md').cards[0]!;expect(()=>replaceCardInSource(source.replace('Answer.','Concurrent answer.'),c,'Edited?','New','first')).toThrow(/changed/);});
it('rejects ambiguous unidentified duplicates rather than guessing by line',()=>{const source=block+'\n'+block;expect(()=>ensureIdInSource(source,parseCards(source,'a.md').cards[0]!,'id')).toThrow(/ambiguous/);});
it('deletes only the card and ID leaving neighbours untouched',()=>{const source='Before\n\n<!-- qard-id: delete-me -->\n'+block+'\nAfter';expect(deleteCardInSource(source,parseCards(source,'a.md').cards[0]!)).toBe('Before\n\n\nAfter');});
it('bulk deletion handles duplicate IDs and CRLF while preserving surrounding bytes', () => {
  const source = ('---\nqard-deck: Networks\n---\n\nIntro  \n# Transport\n<!-- qard-id: duplicate -->\n' + block + '\n<!-- qard-id: duplicate -->\n' + block + '\n# Routing\n' + block + '\nOutro  \n').replace(/\n/g, '\r\n');
  const next = deleteGroupInSource(source, 'a.md', 'Networks', 'Transport');
  expect(parseCards(next, 'a.md').cards).toHaveLength(1);
  expect(next).toContain('Intro  \r\n# Transport\r\n'); expect(next).toContain('Outro  \r\n');
  expect(next).not.toContain('qard-id: duplicate');
});
it('roundtrips rich fronts and answers without stripping Markdown',()=>{const front='Prompt\n\n$$\nE=mc^2\n$$\n\n![[image.png]]',back='- One\n- Two\n\n`code`';const result=parseCards(serializeCard('abc',front,back),'a.md').cards[0]!;expect(result.frontMarkdown).toBe(front);expect(result.backMarkdown).toBe(back);});
it('rejects nested Qard boundary injection without touching the file',()=>{expect(()=>serializeCard('abc','Prompt','[!qard]- Another question\nAnswer')).toThrow();});
it('edits cards at EOF without appending a new newline',()=>{const source=block.trimEnd();expect(replaceCardInSource(source,parseCards(source,'a.md').cards[0]!,'Changed','Changed','abc').endsWith('\n')).toBe(false);});

it('round-trips a front that starts directly with a fenced code block', () => {
  const front = '```js\nconst x = 1;\n```';
  const source = serializeCard('code-front', front, 'An assignment.');
  const result = parseCards(source, 'a.md').cards[0]!;
  expect(result.frontMarkdown).toBe(front); expect(result.backMarkdown).toBe('An assignment.');
});
