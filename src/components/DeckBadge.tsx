import { Atom, BrainCircuit, ChartNoAxesCombined, Code2, Dna, FlaskConical, Globe2, Landmark, Languages, Lightbulb, Network, Sigma, type LucideIcon } from 'lucide-react';

// Match whole subject words, so short terms such as "AI" do not match unrelated names.
const SUBJECTS: [RegExp, LucideIcon][] = [
  [/\b(ai|artificial intelligence|machine learning|deep learning|automated planning)\b/i, BrainCircuit],
  [/\b(networks?|networking|internet|protocols?)\b/i, Network],
  [/\b(programming|algorithms?|software|coding|computer science|operating systems?)\b/i, Code2],
  [/\b(math(?:s|ematics)?|algebra|calculus|geometry|statistics)\b/i, Sigma],
  [/\b(physics|mechanics|quantum)\b/i, Atom],
  [/\b(chemistry|chemical)\b/i, FlaskConical],
  [/\b(biology|biological|genetics|anatomy|medicine)\b/i, Dna],
  [/\b(data|economics?|finance|business)\b/i, ChartNoAxesCombined],
  [/\b(languages?|linguistics|french|english|spanish|german)\b/i, Languages],
  [/\b(history|law|politics|classics)\b/i, Landmark],
  [/\b(geography|environment|earth)\b/i, Globe2],
  [/\b(philosophy|reasoning|logic|psychology)\b/i, Lightbulb],
];

/** Subject cues with a stable colour; unfamiliar names fall back to a monogram. */
export function DeckBadge({ name }: { name: string }) {
  const Icon = SUBJECTS.find(([pattern]) => pattern.test(name))?.[1];
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? ['?'];
  const first = words[0] ?? '?';
  const initials = (/^[A-Z0-9]{2,3}$/.test(first) ? first : words.length === 1 ? Array.from(first).slice(0, 2).join('') : words.slice(0, 2).map(word => Array.from(word)[0]).join('')).toLocaleUpperCase();
  const tone = Array.from(name).reduce((hash, letter) => ((hash * 31) + letter.codePointAt(0)!) >>> 0, 0) % 6;
  return <span className={`qard-deck-badge qard-tone-${tone}`} aria-hidden="true">{Icon ? <Icon size={23} strokeWidth={1.6}/> : <span>{initials}</span>}</span>;
}
