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
