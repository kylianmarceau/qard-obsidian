import { clozeGroups } from '../cards/card-format';
import type { SrSettings } from './sr-parser';

const known = [
  '==[123;;]answer[;;hint]==',
  '**[123;;]answer[;;hint]**',
  '{{[123;;]answer[;;hint]}}',
  '{{[123::]answer[::hint]}}',
  '==answer[^\\[hint\\]][\\[^123\\]]',
];
/** Standard SR blanks become independent Qard targets, with shared identity for sibling separation. */
export function srCloze(
  body: string,
  settings: SrSettings,
): { text: string; targets: number[] } | undefined {
  const patterns = settings.clozePatterns;
  const enabled = patterns
    ? {
        highlight: patterns.some((p) => p.startsWith('==') && known.includes(p)),
        bold: patterns.includes(known[1]!),
        curly: patterns.includes(known[2]!) || patterns.includes(known[3]!),
      }
    : { highlight: settings.clozeHighlight, bold: settings.clozeBold, curly: settings.clozeCurly };
  const custom = patterns?.find(
    (p) => !known.includes(p) && body.includes(p.split(/\[|answer/)[0]!),
  );
  if (custom) {
    throw new Error(
      'This custom SR cloze pattern needs manual conversion; its text is left unchanged.',
    );
  }
  const alternatives = [
    enabled.highlight ? '==([^\\n]*?)==' : '',
    enabled.bold ? '\\*\\*([^\\n]*?)\\*\\*' : '',
    enabled.curly ? '\\{\\{([^\\n]*?)\\}\\}' : '',
  ].filter(Boolean);
  if (!alternatives.length) {
    return undefined;
  }
  const blanks = new RegExp(
    `(?:${alternatives.join('|')})(?:\\^\\[([^\\]\\n]+)\\])?(?:\\[\\^([^\\]\\n]+)\\])?`,
    'g',
  );
  const protectedSyntax =
    /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$|(`+)[^\n]*?\2(?!`)|<!--[\s\S]*?-->|\\(?:==|\*\*|\{\{)/gm;
  let sequence = 0,
    numbered = false,
    simple = false;
  const transform = (part: string) =>
    part.replace(blanks, (_all, ...args: unknown[]) => {
      const values = args.slice(0, alternatives.length) as (string | undefined)[];
      let answer = values.find((v) => v !== undefined)!.trim();
      const hintValue = args[alternatives.length],
        groupValue = args[alternatives.length + 1];
      let hint = typeof hintValue === 'string' ? hintValue : '',
        group = typeof groupValue === 'string' ? groupValue : '';
      const inline = answer.match(/^(\d+|[ahs]+)(;;|::)([\s\S]+)$/);
      if (inline) {
        group = inline[1]!;
        const parts = inline[3]!.split(inline[2]!);
        answer = parts[0]!;
        hint = parts[1] ?? '';
      } else if (answer.includes(';;')) {
        const parts = answer.split(';;');
        answer = parts[0]!;
        hint = parts[1] ?? '';
      }
      if (!answer?.trim() || /[\r\n]|\{\{c/.test(answer) || /[{}\r\n]/.test(hint)) {
        throw new Error(
          'This cloze blank cannot be represented safely; its text is left unchanged.',
        );
      }
      if (group && !/^[1-9]\d{0,2}$/.test(group)) {
        throw new Error(
          'SR overlapping clozes need manual conversion; their text is left unchanged.',
        );
      }
      if (group) {
        numbered = true;
      } else {
        simple = true;
      }
      const target = group ? Number(group) : ++sequence;
      if (target > 999) {
        throw new Error('Too many cloze blanks in one paragraph.');
      }
      return `{{c${target}::${answer.trim()}${hint ? `::${hint.trim()}` : ''}}}`;
    });
  let text = '',
    cursor = 0;
  for (const match of body.matchAll(protectedSyntax)) {
    text += transform(body.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  text += transform(body.slice(cursor));
  if (numbered && simple) {
    throw new Error('Mixed numbered and unnumbered SR blanks need manual conversion.');
  }
  const targets = clozeGroups(text);
  return targets.length ? { text, targets } : undefined;
}
