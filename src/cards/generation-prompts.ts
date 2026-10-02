import type { FlashcardRequest } from './generation-service';

export function flashcardPrompt(request: FlashcardRequest) {
  return `Create flashcards for the deck ${JSON.stringify(request.deck)}, topic ${JSON.stringify(request.topic)}.
The student's request:\n<request>\n${request.prompt || '(Create a balanced set from the selected notes.)'}\n</request>
${request.notes.length ? `Read these selected notes first:\n${request.notes.map(p => `- ${p}`).join('\n')}` : 'Search the vault for notes relevant to the request. If none fit, use correct standard subject knowledge and leave source empty.'}
Choose how many cards the material needs: cover the important concepts and skills in the notes, with more cards for substantial material and fewer for short notes. There is no fixed target count. Do not pad the set with repetitive or trivial cards. Respect any scope the student requests.
Rules:
${request.format === 'cloze' ? `- Create cloze cards: front is a complete statement, formula or code sample with important parts replaced by {{answer}} or {{answer::short hint}}. Keep the real answer inside the braces. Include at least one blank per card, do not nest blanks, and never blank out everything. All blanks in a card are tested together. back is optional context or an explanation, not a repeated copy of the front.
- Prefer one useful recall target per card; preserve enough context to identify the missing part.
` : ''}
- Each card tests one useful idea. Avoid repeated questions, vague questions and answers that require seeing another card.
- Favour active recall: definitions, distinctions, why/how, formulas and small applications, following the request's emphasis.
- ${request.format === 'cloze' ? 'Use the cloze statement as front and any explanation as back.' : 'Front is the question; back is the shortest answer that explains it correctly.'} Use Markdown and $…$ for maths.
- Ground the cards in the notes you read. source is the exact note path, or empty for general knowledge. Never invent a source.
- Existing flashcards in those notes are context, not text to copy unchanged.
- For attachments and note references use vault wiki links, never relative Markdown attachment paths.
- Return only the card content; Qard will show it for review and save approved cards. Never create, edit or delete files.`;
}
