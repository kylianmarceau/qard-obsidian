import { it, expect, vi } from 'vitest';
import { ReviewStore, type PluginData } from '../src/review/review-store';

/** One device's copy of data.json; `sync` replaces it with another copy, as Obsidian Sync or iCloud would. */
class Disk {
  text = '';
  version = 0;
  copyFrom(other: Disk) {
    this.text = other.text;
    this.version++;
  }
}
function device(disk: Disk, id: string) {
  let seen = disk.version;
  const writes = vi.fn(async (data: PluginData) => {
    disk.text = JSON.stringify(data);
    disk.version++;
    seen = disk.version;
  });
  const store = new ReviewStore(
    writes,
    {
      read: async () => (disk.text ? (JSON.parse(disk.text) as unknown) : null),
      changed: async () => disk.version !== seen,
      acknowledge: async () => {
        seen = disk.version;
      },
    },
    id,
  );
  store.load(disk.text ? JSON.parse(disk.text) : null);
  return { store, writes, data: () => store.getSnapshot() };
}
/** A laptop and a phone that start from the same synced progress. */
async function pair() {
  const laptopDisk = new Disk();
  const first = device(laptopDisk, 'laptop');
  await first.store.review('shared', 3, Date.UTC(2026, 9, 1, 8));
  const phoneDisk = new Disk();
  phoneDisk.copyFrom(laptopDisk);
  return {
    laptopDisk,
    phoneDisk,
    laptop: device(laptopDisk, 'laptop'),
    phone: device(phoneDisk, 'phone'),
  };
}
const keys = (data: PluginData) => data.history.map((e) => `${e.cardId}@${e.at}`).sort();
const day = (hour: number) => Date.UTC(2026, 9, 2, hour);

it('keeps reviews made on two devices before they synced', async () => {
  const { laptopDisk, phoneDisk, laptop, phone } = await pair();
  await laptop.store.review('laptop-card', 3, day(9));
  await phone.store.review('phone-card', 4, day(10));
  // The phone's file arrives last and replaces the laptop's.
  laptopDisk.copyFrom(phoneDisk);
  await laptop.store.syncExternal();
  expect(keys(laptop.data())).toEqual(
    [`laptop-card@${day(9)}`, `phone-card@${day(10)}`, `shared@${Date.UTC(2026, 9, 1, 8)}`].sort(),
  );
  expect(laptop.data().states['laptop-card']?.reviewCount).toBe(1);
  expect(laptop.data().states['phone-card']?.reviewCount).toBe(1);
  expect(laptop.data().statistics.daily['2026-10-02']?.reduce((a, b) => a + b, 0)).toBe(2);
  // The merged file reaches the phone, which has nothing to add and does not write back.
  phoneDisk.copyFrom(laptopDisk);
  const writes = phone.writes.mock.calls.length;
  await phone.store.syncExternal();
  expect(phone.writes.mock.calls.length).toBe(writes);
  expect(keys(phone.data())).toEqual(keys(laptop.data()));
});

it('merges a replaced file on the next save even without a sync notification', async () => {
  const { laptopDisk, phoneDisk, laptop, phone } = await pair();
  await phone.store.review('phone-card', 1, day(9));
  laptopDisk.copyFrom(phoneDisk);
  await laptop.store.review('laptop-card', 3, day(11));
  const saved = JSON.parse(laptopDisk.text) as PluginData;
  expect(saved.history.map((e) => e.cardId).sort()).toEqual([
    'laptop-card',
    'phone-card',
    'shared',
  ]);
});

it('replays one card reviewed on both devices as if it were reviewed on one', async () => {
  const { laptopDisk, phoneDisk, laptop, phone } = await pair();
  await laptop.store.review('shared', 1, day(9));
  await phone.store.review('shared', 4, day(12));
  laptopDisk.copyFrom(phoneDisk);
  await laptop.store.syncExternal();
  const single = device(new Disk(), 'single');
  await single.store.review('shared', 3, Date.UTC(2026, 9, 1, 8));
  await single.store.review('shared', 1, day(9));
  await single.store.review('shared', 4, day(12));
  const merged = laptop.data().states.shared!;
  const expected = single.data().states.shared!;
  expect(merged.reviewCount).toBe(3);
  expect(merged.lapses).toBe(1);
  expect(merged.due).toBe(expected.due);
  expect(merged.fsrs?.stability).toBeCloseTo(expected.fsrs!.stability, 9);
});

it('does not bring back a rating that was undone on another device', async () => {
  const { laptopDisk, phoneDisk, laptop, phone } = await pair();
  const undo = await laptop.store.review('mistake', 1, day(9));
  phoneDisk.copyFrom(laptopDisk);
  await phone.store.syncExternal();
  await laptop.store.undoReview(undo);
  await phone.store.review('other', 3, day(10)); // The phone still has the mistaken rating.
  laptopDisk.copyFrom(phoneDisk);
  await laptop.store.syncExternal();
  expect(laptop.data().history.some((e) => e.cardId === 'mistake')).toBe(false);
  expect(laptop.data().states.mistake).toBeUndefined();
  expect(laptop.data().states.other?.reviewCount).toBe(1);
});

it('keeps a pause when an older copy without it arrives', async () => {
  const { laptopDisk, phoneDisk, laptop, phone } = await pair();
  await laptop.store.setPaused('shared', true);
  await phone.store.review('other', 3, day(10));
  laptopDisk.copyFrom(phoneDisk); // Stale: made before the phone saw the pause.
  await laptop.store.syncExternal();
  expect(laptop.data().states.shared?.paused).toBe(true);
  expect(laptop.data().states.other?.reviewCount).toBe(1);
});

it('does not resurrect a finished session or a deleted exam', async () => {
  const { laptopDisk, phoneDisk, laptop, phone } = await pair();
  laptopDisk.copyFrom(phoneDisk);
  const card = { id: 'shared', stable: true, deck: 'Networks' } as Parameters<
    ReviewStore['startSession']
  >[0][number];
  const session = await laptop.store.startSession([card], 'cram');
  phoneDisk.copyFrom(laptopDisk);
  await phone.store.syncExternal();
  expect(phone.data().sessions).toHaveLength(1);
  await laptop.store.discardSession(session.id);
  await phone.store.review('other', 3, day(10));
  laptopDisk.copyFrom(phoneDisk);
  await laptop.store.syncExternal();
  expect(laptop.data().sessions).toHaveLength(0);
});

it('adds study time recorded on both devices', async () => {
  const { laptopDisk, phoneDisk, laptop, phone } = await pair();
  await laptop.store.recordStudy({ '2026-10-02': { 'review|': 60 } }, '2026-10-02');
  await phone.store.recordStudy({ '2026-10-02': { 'review|': 45 } }, '2026-10-02');
  laptopDisk.copyFrom(phoneDisk);
  await laptop.store.syncExternal();
  expect(laptop.data().study['2026-10-02']?.['review|']).toBe(105);
  // A second, older copy of the phone's file does not count its time again.
  laptopDisk.copyFrom(phoneDisk);
  await laptop.store.syncExternal();
  expect(laptop.data().study['2026-10-02']?.['review|']).toBe(105);
});

it('keeps the newer settings change', async () => {
  const { laptopDisk, phoneDisk, laptop, phone } = await pair();
  await phone.store.saveSettings({ ...phone.data().settings, desiredRetention: 0.85 });
  laptopDisk.copyFrom(phoneDisk);
  await laptop.store.syncExternal();
  expect(laptop.data().settings.desiredRetention).toBe(0.85);
});

it('ignores an empty or damaged synced file', async () => {
  const { laptopDisk, laptop } = await pair();
  laptopDisk.text = '{}';
  laptopDisk.version++;
  expect(await laptop.store.syncExternal()).toBe(false);
  await laptop.store.review('next', 3, day(9));
  expect(
    laptop
      .data()
      .history.map((e) => e.cardId)
      .sort(),
  ).toEqual(['next', 'shared']);
});

const card = (id: string) =>
  ({ id, stable: true, deck: 'Networks' }) as Parameters<ReviewStore['startSession']>[0][number];
/** Passes the file back and forth until neither device writes; returns the number of round trips. */
async function settle(p: Awaited<ReturnType<typeof pair>>) {
  for (let round = 0; round < 10; round++) {
    const before = p.laptop.writes.mock.calls.length + p.phone.writes.mock.calls.length;
    p.phoneDisk.copyFrom(p.laptopDisk);
    await p.phone.store.syncExternal();
    p.laptopDisk.copyFrom(p.phoneDisk);
    await p.laptop.store.syncExternal();
    if (p.laptop.writes.mock.calls.length + p.phone.writes.mock.calls.length === before) {
      return round;
    }
  }
  return Infinity;
}

it('stops writing once sessions and exams made on both devices are merged', async () => {
  const p = await pair();
  const exam = (id: string) => ({
    id,
    name: id,
    date: '2026-12-01',
    selection: { decks: ['Networks'], topics: [], cards: [] },
    weekdays: [1, 3],
    dailyLimit: 10,
    createdAt: day(8),
  });
  await p.laptop.store.startSession([card('a')], 'cram');
  await p.phone.store.startSession([card('b')], 'cram');
  await p.laptop.store.saveExam(exam('laptop-exam'));
  await p.phone.store.saveExam(exam('phone-exam'));
  expect(await settle(p)).toBeLessThan(3);
  expect(p.laptop.data().sessions).toHaveLength(2);
  expect(
    p.phone
      .data()
      .exams.map((e) => e.id)
      .sort(),
  ).toEqual(['laptop-exam', 'phone-exam']);
});

it('stops writing after one device switches scheduler', async () => {
  // The later change wins by its timestamp, so the two changes must not land in the same millisecond.
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(day(12));
    const p = await pair();
    await p.laptop.store.saveSettings({ ...p.laptop.data().settings, scheduler: 'simple' });
    expect(await settle(p)).toBeLessThan(3);
    expect(p.phone.data().settings.scheduler).toBe('simple');
    expect(p.phone.data().states.shared?.fsrs).toBeUndefined();
    vi.setSystemTime(day(13));
    await p.phone.store.saveSettings({ ...p.phone.data().settings, scheduler: 'fsrs' });
    expect(await settle(p)).toBeLessThan(3);
    expect(p.laptop.data().states.shared).toEqual(p.phone.data().states.shared);
    expect(p.laptop.data().states.shared?.fsrs).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});

it('keeps a resume after the card is rated, when an older paused copy arrives', async () => {
  const p = await pair();
  await p.phone.store.setPaused('shared', true);
  const stale = new Disk();
  stale.copyFrom(p.phoneDisk);
  p.laptopDisk.copyFrom(p.phoneDisk);
  await p.laptop.store.syncExternal();
  await p.laptop.store.setPaused('shared', false);
  await p.laptop.store.review('shared', 3, day(9));
  p.laptopDisk.copyFrom(stale);
  await p.laptop.store.syncExternal();
  expect(p.laptop.data().states.shared?.paused).toBeUndefined();
  expect(p.laptop.data().states.shared?.reviewCount).toBe(2);
});

it("refuses an undo that would remove another device's rating", async () => {
  const p = await pair();
  const undo = await p.laptop.store.review('mine', 1, day(9));
  await p.phone.store.review('theirs', 3, day(10));
  p.laptopDisk.copyFrom(p.phoneDisk); // Replaced, but no sync notification has run yet.
  await expect(p.laptop.store.undoReview(undo)).rejects.toThrow('cannot be undone');
  await p.laptop.store.flush();
  expect(
    p.laptop
      .data()
      .history.map((e) => e.cardId)
      .sort(),
  ).toEqual(['mine', 'shared', 'theirs']);
  expect(p.laptop.data().removed).toEqual([]);
  expect(p.laptop.store.canUndoReview(undo)).toBe(false);
});

it('keeps study time and usage reset on every device', async () => {
  const p = await pair();
  await p.phone.store.recordUsage('2026-10-02', 'k', { input: 5, output: 5 } as never);
  await p.phone.store.recordStudy({ '2026-10-02': { 'review|': 45 } }, '2026-10-02');
  await settle(p);
  const stale = new Disk();
  stale.copyFrom(p.phoneDisk);
  await p.laptop.store.resetUsage();
  expect(await settle(p)).toBeLessThan(3);
  expect(p.phone.data().usage).toEqual({});
  expect(p.phone.data().study['2026-10-02']?.['review|']).toBe(45);
  // Counting continues after the reset, and a copy from before it adds nothing back.
  await p.phone.store.recordUsage('2026-10-03', 'k', { input: 2, output: 1 } as never);
  await settle(p);
  p.laptopDisk.copyFrom(stale);
  await p.laptop.store.syncExternal();
  expect(Object.keys(p.laptop.data().usage)).toEqual(['2026-10-03']);
  await p.laptop.store.resetStudy();
  await settle(p);
  expect(p.phone.data().study).toEqual({});
});
