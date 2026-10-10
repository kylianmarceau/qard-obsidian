// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { readAnki, zstd } from '../src/migration/anki';
import { ankiMarkdown, renderTemplate } from '../src/migration/anki-content';
import { readCardFormat } from '../src/cards/card-format';
import { ankiFixture, rawZstd } from './anki-fixture';
import { transferFixture } from './transfer-fixture';

for (const modern of [false, true]) {
  it(`imports ${modern ? 'modern Zstandard/protobuf' : 'legacy JSON'} packages, preserving Markdown, decks, tags and review dates`, async () => {
    const input = await readAnki(await ankiFixture({ modern }));
    expect(input.issues).toEqual([]);
    expect(input.cards).toHaveLength(1);
    expect(input.cards[0]).toMatchObject({
      front: 'What does **TCP** provide?',
      back: '**Reliable**, ordered delivery.',
      deck: 'Networks::Transport',
      tags: ['networking', 'TCP'],
      state: { interval: 10, reviewCount: 2, lapses: 1, ease: 2.5 },
    });
    const date = new Date(2025, 0, 1);
    date.setDate(date.getDate() + 500);
    expect(input.cards[0]?.state?.due).toBe(date.getTime());
    expect(input.cards[0]?.history).toHaveLength(2);
  });
  it(`imports ${modern ? 'modern' : 'legacy'} cloze siblings and reversed templates as independently scheduled cards`, async () => {
    const cloze = await readAnki(await ankiFixture({ modern, kind: 1 }));
    expect(cloze.issues).toEqual([]);
    expect(cloze.cards).toHaveLength(2);
    expect(cloze.cards.map((c) => readCardFormat(c.front))).toMatchObject([
      { kind: 'cloze', target: 1 },
      { kind: 'cloze', target: 2 },
    ]);
    expect(cloze.cards.every((c) => c.back === '**Transport protocol.**')).toBe(true);
    expect(cloze.cards[0]?.group).toBe(cloze.cards[1]?.group);
    const reverse = await readAnki(
      await ankiFixture({
        modern,
        templates: [
          { front: '{{Front}}', back: '{{Back}}' },
          { front: '{{Back}}', back: '{{Front}}' },
        ],
      }),
    );
    expect(reverse.cards).toHaveLength(2);
    expect(reverse.cards[1]?.front).toBe(reverse.cards[0]?.back);
  });
  it(`extracts ${modern ? 'compressed' : 'legacy'} image and sound media and resumes safely after metadata failure`, async () => {
    const input = await readAnki(
      await ankiFixture({
        modern,
        fields: ['Identify <img src="diagram.png">', 'TCP. [sound:voice.mp3]'],
        media: { 'diagram.png': new Uint8Array([1, 2]), 'voice.mp3': new Uint8Array([3, 4]) },
        queue: -1,
      }),
    );
    expect(input.issues).toEqual([]);
    expect(input.media).toHaveLength(2);
    const f = transferFixture(),
      plan = await f.service.prepare(input, 'Qard', 'cards.apkg');
    f.persist.mockRejectedValueOnce(new Error('Save failed'));
    await expect(f.service.apply(plan, input)).rejects.toThrow('Save failed');
    const resumed = f.makeService(),
      [pending] = await resumed.pending();
    await resumed.apply(pending!);
    expect(f.index.getSnapshot().cards).toHaveLength(1);
    expect(f.createBinary).toHaveBeenCalledTimes(3);
    expect(f.reviews.getSnapshot().states[plan.cards[0]!.id]?.paused).toBe(true);
    expect(f.reviews.getSnapshot().history).toHaveLength(2);
    expect(f.index.getSnapshot().cards[0]?.frontMarkdown).toContain('![[Qard/Imported media/');
  });
}
it('converts math and rich text without executing template code or loading remote resources', () => {
  expect(
    ankiMarkdown(
      'Inline \\(x_1\\) and display \\[E=mc^2\\].<script>window.bad=true</script><img src="https://example.com/image.png">',
      new Map(),
    ),
  ).toBe('Inline $x_1$ and display $$E=mc^2$$.[Remote media](https://example.com/image.png)');
  expect(
    renderTemplate(
      '{{#Extra}}{{Front}}{{/Extra}}{{^Extra}}{{Back}}{{/Extra}}',
      { Extra: '', Front: 'Q', Back: 'A' },
      'front',
    ),
  ).toBe('A');
  expect(renderTemplate('{{Front}}<br>{{type:Back}}', { Front: 'Q', Back: 'A' }, 'front')).toBe(
    'Q<br>',
  );
  expect(() => renderTemplate('{{tts en_US:Front}}', { Front: 'Q' }, 'front')).toThrow('filter');
});
it('reports unsupported templates, masks and missing media instead of importing broken cards', async () => {
  const script = await readAnki(
    await ankiFixture({
      templates: [{ front: '<script>draw()</script>{{Front}}', back: '{{Back}}' }],
    }),
  );
  expect(script.cards).toEqual([]);
  expect(script.issues[0]?.message).toContain('JavaScript');
  const mask = await readAnki(await ankiFixture({ modern: true, stock: 6 }));
  expect(mask.issues[0]?.message).toContain('image-occlusion');
  const missing = await readAnki(await ankiFixture({ fields: ['<img src="missing.png">', 'A'] }));
  expect(missing.issues[0]?.message).toContain('Missing');
  const badPath = await readAnki(
    await ankiFixture({
      fields: ['<img src="../evil.png">', 'A'],
      media: { '../evil.png': new Uint8Array([1]) },
    }),
  );
  expect(badPath.media).toEqual([]);
  expect(badPath.cards).toEqual([]);
});
it('rejects corrupt packages and bounds decompression', async () => {
  await expect(readAnki(new Uint8Array([1, 2]))).rejects.toThrow();
  expect(() => zstd(rawZstd(new Uint8Array(100)), 50)).toThrow('too large');
});
it('preserves ordinary tables and reports merged cells', () => {
  expect(
    ankiMarkdown(
      '<table><tr><th>Protocol</th><th>Delivery</th></tr><tr><td>TCP</td><td><b>Reliable</b></td></tr></table>',
      new Map(),
    ),
  ).toBe('| Protocol | Delivery |\n| --- | --- |\n| TCP | **Reliable** |');
  expect(() =>
    ankiMarkdown('<table><tr><td colspan="2">Merged</td></tr></table>', new Map()),
  ).toThrow('merged');
});
it('rejects a huge claimed decompression window before allocating it', () => {
  const bytes = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0xff, 0xff, 0xff, 0x7f, 1, 0, 0]);
  expect(() => zstd(bytes)).toThrow('too large');
});
