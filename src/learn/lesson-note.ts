import { isoDay } from './mastery';
import { figureMarkdown } from './figures';
import { tidyMermaid } from './mermaid';
import type { Lesson } from './learn-types';

/** Builds the saved lesson transcript; the service owns the file write. */
export function formatLessonNote(path: string, lesson: Lesson, summary: string) {
  const notePath = path.replace(/\.json$/, '.md'),
    day = isoDay(lesson.createdAt);
  const steps = lesson.steps
    .map((s, i) => {
      if (!s) {
        return '';
      }
      const st = lesson.state[i],
        a = st?.answer;
      const answer = a?.unknown
        ? "_I didn't know._"
        : s.check.type === 'mcq'
          ? (s.check.options?.[a?.choice ?? -1] ?? '_No answer._')
          : a?.text?.trim() || '_No answer._';
      return `### ${i + 1}. ${s.title}\n\n${s.explain}${st?.figure ? `\n\n${figureMarkdown(st.figure)}` : ''}\n\n${s.connect}\n\n**Check:** ${s.check.prompt}\n\n**My answer${st?.mark ? ` (${st.mark.score}/${s.check.marks})` : ''}:** ${answer}\n\n**Model answer:** ${s.check.model}${st?.asks.length ? '\n\n' + st.asks.map((x) => `> **Q:** ${x.q}\n> ${(x.figure ? `${x.a}\n\n${figureMarkdown(x.figure)}` : x.a).replace(/\n/g, '\n> ')}`).join('\n\n') : ''}`;
    })
    .filter(Boolean)
    .join('\n\n');
  const mastery = lesson.mastery
    ? ` · [[${lesson.mastery.replace(/\.md$/, '')}|${lesson.course ?? 'Mastery'}]]${lesson.objective ? ` · \`${lesson.objective}\`` : ''}`
    : '';
  const body = `---\nqard-lesson: true\n${lesson.objective ? `qard-objective: ${lesson.objective}\n` : ''}---\n\n# ${lesson.map?.title ?? lesson.topic}\n\n${day}${mastery}\n\n## Summary\n\n${summary.trim()}\n\n## Plan\n\n${lesson.map?.plan ?? ''}\n\n\`\`\`mermaid\n${tidyMermaid(lesson.map?.mermaid ?? '')}\n\`\`\`\n\n## Steps\n\n${steps}\n`;
  return { path: notePath, text: body };
}
