// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { type App, TFile } from 'obsidian';
import { isStudySource, studyPdfs, studySources } from '../src/vault-access';
import {
  MAX_PDF_CHARS,
  documentText,
  extractPdfPages,
  pageText,
  splitPages,
  type PdfJs,
} from '../src/sources/pdf-text';
import { PdfReader } from '../src/sources/pdf-reader';
import { runVaultTool } from '../src/agents/vault-tools';
import { CodexRunner, type Child, type NodeHost } from '../src/agents/cli-runner';
import { SourceSyncService, sourceNoteText } from '../src/cards/source-sync-service';
import { FlashcardGenerationService } from '../src/cards/generation-service';
import { testNotePaths } from '../src/tests/test-sources';
import type { AgentRunner } from '../src/agents/runner';

const line = (str: string) => ({ str, hasEOL: true, transform: [1, 0, 0, 1, 0, 0] });
/** PDF.js as far as text extraction goes: each page is a list of text items. */
function fakePdfJs(pages: readonly (readonly unknown[])[], failure?: unknown) {
  const sources: unknown[] = [];
  let destroyed = 0;
  const lib: PdfJs = {
    getDocument: (source) => {
      sources.push(source);
      return {
        promise: failure
          ? Promise.reject(failure instanceof Error ? failure : new Error(String(failure)))
          : Promise.resolve({
              numPages: pages.length,
              getPage: async (n: number) => ({
                getTextContent: async () => ({ items: pages[n - 1]! }),
              }),
            }),
        destroy: async () => {
          destroyed++;
        },
      };
    },
  };
  return { lib, sources, destroyed: () => destroyed };
}
const file = (path: string, mtime = 1, size = 10) =>
  Object.assign(new (TFile as unknown as new (p: string) => TFile)(path), {
    stat: { mtime, size },
  });

describe('which files are study sources', () => {
  it('adds PDFs to notes, without hidden files, excluded folders or other attachments', () => {
    const notes = ['Course/Notes.md', '.obsidian/x.md'].map((p) => file(p));
    const all = [
      ...notes,
      'Course/Slides.pdf',
      'Course/Scan.PDF',
      'Course/.private/Old.pdf',
      'Qard/Tests/report.pdf',
      'Course/diagram.png',
    ].map((p) => (typeof p === 'string' ? file(p) : p));
    const app = { vault: { getMarkdownFiles: () => notes, getFiles: () => all } } as unknown as App;
    expect(studySources(app, ['Qard/Tests']).map((f) => f.path)).toEqual([
      'Course/Notes.md',
      'Course/Slides.pdf',
      'Course/Scan.PDF',
    ]);
    expect(studyPdfs(app).map((f) => f.path)).toEqual([
      'Course/Slides.pdf',
      'Course/Scan.PDF',
      'Qard/Tests/report.pdf',
    ]);
    expect(isStudySource('../Slides.pdf')).toBe(false);
    expect(isStudySource('Course/Notes.md')).toBe(true);
    expect(testNotePaths(['Course/Slides.pdf', 'Course/diagram.png'], 'Qard/Tests')).toEqual([
      'Course/Slides.pdf',
    ]);
  });
});

describe('PDF text', () => {
  it('joins text items into lines, one marked block per page', () => {
    const page = pageText([
      { str: 'Transport', hasEOL: false },
      { str: '  layer', hasEOL: true },
      { type: 'beginMarkedContent' },
      { str: '', hasEOL: true },
      { str: 'TCP is\treliable.', hasEOL: true },
    ]);
    expect(page).toBe('Transport layer\n\nTCP is reliable.');
    const text = documentText([page, '', 'UDP is not.']);
    expect(text).toBe(
      '[Page 1]\nTransport layer\n\nTCP is reliable.\n\n[Page 2]\n\n[Page 3]\nUDP is not.',
    );
    expect(splitPages(text)).toEqual([
      { page: 1, text: 'Transport layer\n\nTCP is reliable.' },
      { page: 2, text: '' },
      { page: 3, text: 'UDP is not.' },
    ]);
    // A page added at the end leaves the earlier text, and so a source comparison, unchanged.
    expect(documentText([page, '', 'UDP is not.', 'QUIC.']).startsWith(text)).toBe(true);
  });

  it('breaks lines at baseline changes when PDF.js does not mark line ends', () => {
    expect(
      pageText([
        { str: 'First ', transform: [1, 0, 0, 1, 0, 700] },
        { str: 'line', transform: [1, 0, 0, 1, 40, 700] },
        { str: 'Second line', transform: [1, 0, 0, 1, 0, 680] },
      ]),
    ).toBe('First line\nSecond line');
  });

  it('reads every page without fonts or evaluated code, and always releases the document', async () => {
    const pdf = fakePdfJs([[line('One')], [line('Two')]]);
    expect(await extractPdfPages(pdf.lib, new ArrayBuffer(8), 'Slides.pdf')).toEqual([
      'One',
      'Two',
    ]);
    expect(pdf.sources[0]).toMatchObject({ isEvalSupported: false, disableFontFace: true });
    expect(pdf.destroyed()).toBe(1);
  });

  it('explains PDFs it cannot use instead of sending them empty or cut short', async () => {
    const locked = fakePdfJs([], Object.assign(new Error('x'), { name: 'PasswordException' }));
    await expect(extractPdfPages(locked.lib, new ArrayBuffer(8), 'A.pdf')).rejects.toThrow(
      'A.pdf is password-protected',
    );
    expect(locked.destroyed()).toBe(1);
    const scan = fakePdfJs([[], [{ str: ' ', hasEOL: true }]]);
    await expect(extractPdfPages(scan.lib, new ArrayBuffer(8), 'Scan.pdf')).rejects.toThrow(
      'has no selectable text',
    );
    const book = fakePdfJs(Array.from({ length: 3 }, () => [line('x'.repeat(MAX_PDF_CHARS / 2))]));
    await expect(extractPdfPages(book.lib, new ArrayBuffer(8), 'Book.pdf')).rejects.toThrow(
      'too long to use as one source',
    );
    expect(book.destroyed()).toBe(1);
    const broken = fakePdfJs([], Object.assign(new Error('x'), { name: 'InvalidPDFException' }));
    await expect(extractPdfPages(broken.lib, new ArrayBuffer(8), 'B.pdf')).rejects.toThrow(
      'not a valid PDF',
    );
  });

  it('extracts a PDF once per version and again after it changes', async () => {
    let current = file('Course/Slides.pdf', 1);
    const pdf = fakePdfJs([[line('Slow start doubles the window.')]]);
    const readBinary = vi.fn(async () => new ArrayBuffer(8));
    const app = {
      vault: {
        getAbstractFileByPath: (p: string) => (p === current.path ? current : null),
        readBinary,
      },
    } as unknown as App;
    const reader = new PdfReader(app, async () => pdf.lib);
    const [a, b] = await Promise.all([
      reader.read('Course/Slides.pdf'),
      reader.read('Course/Slides.pdf'),
    ]);
    expect(a).toBe('[Page 1]\nSlow start doubles the window.');
    expect(b).toBe(a);
    expect(readBinary).toHaveBeenCalledTimes(1);
    current = file('Course/Slides.pdf', 2);
    await reader.read('Course/Slides.pdf');
    expect(readBinary).toHaveBeenCalledTimes(2);
    expect(await reader.read('Course/Missing.pdf')).toBeNull();
    current = file('Course/Slides.pdf', 3, 200 * 1024 * 1024);
    await expect(reader.read('Course/Slides.pdf')).rejects.toThrow('larger than 100 MB');
    expect(readBinary).toHaveBeenCalledTimes(2);
  });
});

describe('AI access to PDFs', () => {
  const long = documentText(
    Array.from({ length: 40 }, (_, i) => `Page ${i + 1} text. ${'y'.repeat(3000)}`),
  );
  const vault = {
    paths: () => ['Notes/TCP.md', 'Course/Lecture 3.pdf', 'Course/Book.pdf', 'Qard/Tests/x.pdf'],
    read: async (p: string) => {
      if (p === 'Course/Book.pdf') {
        throw new Error('Course/Book.pdf is password-protected. Remove the password.');
      }
      return p === 'Notes/TCP.md' ? 'TCP lecture notes.' : long;
    },
  };

  it('lists PDFs, finds them by name, and reads long ones in parts', async () => {
    expect(await runVaultTool(vault, 'list_notes', { folder: 'Course' }, ['Qard/Tests'])).toBe(
      'Course/Lecture 3.pdf\nCourse/Book.pdf',
    );
    expect(await runVaultTool(vault, 'search_notes', { query: 'lecture' })).toBe(
      'Notes/TCP.md\n  …TCP lecture notes.…\nCourse/Lecture 3.pdf\n  (PDF matched by file name; read it with read_note)',
    );
    // PDF contents aren't searched: extracting a whole vault of PDFs would take too long.
    expect(await runVaultTool(vault, 'search_notes', { query: 'Page 7' })).toBe(
      'No matching notes.',
    );
    const first = await runVaultTool(vault, 'read_note', { path: 'Course/Lecture 3.pdf' });
    expect(first.startsWith('[Page 1]\nPage 1 text.')).toBe(true);
    expect(first.length).toBeLessThan(62_000);
    const next = /start_page (\d+)/.exec(first)![1]!;
    expect(first).toContain('The PDF has 40 pages.');
    const rest = await runVaultTool(vault, 'read_note', {
      path: 'Course/Lecture 3.pdf',
      start_page: Number(next),
    });
    expect(rest.startsWith(`[Page ${next}]\nPage ${next} text.`)).toBe(true);
    expect(await runVaultTool(vault, 'read_note', { path: 'Course/Book.pdf' })).toContain(
      'password-protected',
    );
    expect(
      await runVaultTool(vault, 'read_note', { path: 'Qard/Tests/x.pdf' }, ['Qard/Tests']),
    ).toMatch(/No note/);
  });

  it('gives Codex the text of PDFs a prompt names, unless the prompt already holds it', async () => {
    const inputs: string[] = [];
    const host: NodeHost = {
      env: { PATH: '/usr/bin' },
      home: '/home/me',
      windows: false,
      exists: (p) => p === '/bin/codex' || p.startsWith('/tmp/'),
      readFile: () => '{"ok":true}',
      remove: () => {},
      tempFile: (name) => `/tmp/${name}`,
      spawn: (command) => {
        const child: Child = {
          stdout: { on: () => {} },
          stderr: { on: () => {} },
          // The login shell that finds PATH is spawned too; only Codex's input matters here.
          stdin: {
            on: () => {},
            end: (data) => void (command === '/bin/codex' && inputs.push(data)),
          },
          on: (event: 'error' | 'close', listener: (value: never) => void) => {
            if (event === 'close') {
              setTimeout(() => (listener as (code: number) => void)(0), 0);
            }
          },
          kill: () => true,
        };
        return child;
      },
    };
    const read = vi.fn(async (p: string) =>
      p === 'Slides.pdf' ? 'Root slides that nobody named.' : '[Page 1]\nSlow start doubles cwnd.',
    );
    const runner = new CodexRunner(host, '/vault', '/bin/codex', '', {
      paths: () => ['Course/Slides.pdf', 'Slides.pdf'],
      read,
    });
    const schema = { type: 'object' } as never;
    await runner.run({ prompt: 'Sources:\n- Course/Slides.pdf', schema });
    expect(inputs[0]).toContain(
      '<pdf path="Course/Slides.pdf">\n[Page 1]\nSlow start doubles cwnd.',
    );
    expect(inputs[0]).not.toContain('Root slides');
    // Generation already sends the snapshot inside JSON, so the text isn't added twice.
    const snapshot = JSON.stringify([
      { path: 'Course/Slides.pdf', text: '[Page 1]\nSlow start doubles cwnd.' },
    ]);
    await runner.run({ prompt: `Read Course/Slides.pdf.\n${snapshot}`, schema });
    expect(inputs[1]).not.toContain('<pdf path=');
    await runner.run({ prompt: 'Course/Slides.pdf', schema, vault: false });
    expect(inputs[2]).not.toContain('<pdf path=');
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('PDFs as card sources', () => {
  it('tracks a PDF source and reports its changed passage', async () => {
    const files: Record<string, string> = {
      'Course/Slides.pdf': '[Page 1]\nThe window starts at one segment.',
    };
    const service = new SourceSyncService(
      {
        read: async (p) => files[p] ?? null,
        write: async (p, text) => {
          files[p] = text;
        },
      },
      'Qard/Source links.json',
      () => [
        {
          id: 'card-1',
          stable: true,
          frontMarkdown: 'Where does the window start?',
          backMarkdown: 'One segment.',
        } as never,
      ],
      { edit: vi.fn() },
      vi.fn(),
      () => ({ name: 'Writer', run: vi.fn() }),
    );
    await service.track('card-1', await service.capture(['Course/Slides.pdf']));
    files['Course/Slides.pdf'] = '[Page 1]\nThe window starts at ten segments.';
    await service.refresh();
    expect(service.getSnapshot().changes[0]?.sources).toEqual([
      {
        path: 'Course/Slides.pdf',
        before: '[Page 1]\nThe window starts at one segment.',
        after: '[Page 1]\nThe window starts at ten segments.',
      },
    ]);
    // Card syntax quoted in a PDF is study material, not a card to set aside.
    const quoted = '<!-- qard-id: card-1 -->\n> [!qard]- Q\n> A';
    expect(sourceNoteText(quoted, 'Course/Slides.pdf', ['card-1'])).toBe(quoted);
  });

  it('saves a long source once in the draft and restores it to every card', async () => {
    const text = `[Page 1]\nTCP lecture. ${'Congestion control. '.repeat(500)}`;
    const files: Record<string, string> = {};
    const storage = {
      read: async (p: string) => files[p] ?? null,
      write: async (p: string, t: string) => {
        files[p] = t;
      },
    };
    const reply = {
      cards: ['slow start', 'fast recovery', 'congestion avoidance'].map((name) => ({
        front: `What is ${name}?`,
        back: 'A TCP phase.',
        source: 'Course/TCP_Lecture.pdf',
      })),
    };
    const make = () =>
      new FlashcardGenerationService(
        storage,
        () => 'Qard',
        () => ['Course/TCP_Lecture.pdf'],
        () => ({ name: 'Writer', run: vi.fn<AgentRunner['run']>().mockResolvedValue(reply) }),
        { createBatch: vi.fn().mockResolvedValue([]) },
        undefined,
        undefined,
        undefined,
        async (paths) => paths.map((path) => ({ path, text })),
      );
    const service = make();
    await service.load();
    await service.start({
      deck: 'Networks',
      topic: 'Transport',
      prompt: '',
      notes: ['Course/TCP_Lecture.pdf'],
    });
    await vi.waitFor(() => expect(service.getSnapshot().batch?.cards).toHaveLength(3));
    await service.flush();
    const saved = files['Qard/Flashcard drafts.json']!;
    expect(saved.split('TCP lecture.').length - 1).toBe(1);
    service.useTopicsFromNotes();
    expect(service.getSnapshot().batch!.cards.map((c) => c.topic)).toEqual([
      'TCP Lecture',
      'TCP Lecture',
      'TCP Lecture',
    ]);
    const restored = make();
    await restored.load();
    expect(
      restored.getSnapshot().batch!.cards.map((c) => c.sourceSnapshots?.[0]?.text === text),
    ).toEqual([true, true, true]);
    // Drafts saved by earlier versions keep a copy on each card.
    const draft = JSON.parse(saved) as { sources?: unknown; cards: Record<string, unknown>[] };
    files['Qard/Flashcard drafts.json'] = JSON.stringify({
      ...draft,
      sources: undefined,
      cards: draft.cards.map((c) => ({
        ...c,
        sourceSnapshots: [{ path: 'Course/TCP_Lecture.pdf', text: 'Older copy.' }],
      })),
    });
    const older = make();
    await older.load();
    expect(older.getSnapshot().batch!.cards[0]!.sourceSnapshots).toEqual([
      { path: 'Course/TCP_Lecture.pdf', text: 'Older copy.' },
    ]);
  });
});
