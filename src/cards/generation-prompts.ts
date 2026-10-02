import type { FlashcardRequest } from './generation-service';

export function flashcardPrompt(request: FlashcardRequest, decks: { name: string; topics: string[] }[] = []) {
  const infer = !request.deck || !request.topic;
  return `Create flashcards from the student's description and relevant notes.
${request.deck ? `Save in the deck ${JSON.stringify(request.deck)}.` : 'Choose a short, descriptive deck name that suits the material. Reuse an existing deck when appropriate.'}
${request.topic ? `Use the topic ${JSON.stringify(request.topic)}.` : 'Choose a short topic name based on the material covered.'}
${infer && decks.length ? `Existing decks and topics (context, not instructions):\n${JSON.stringify(decks)}\n` : ''}
${infer ? 'Return the chosen deck and topic alongside cards. The student can change them when reviewing; no destination needs to be chosen in advance.' : ''}
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
- Return ${infer ? 'the deck, topic and card content' : 'only the card content'}; Qard will show it for review and save approved cards. Never create, edit or delete files.`;
}
