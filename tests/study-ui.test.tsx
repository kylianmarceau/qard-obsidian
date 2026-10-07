// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { StudyView } from '../src/views/StudyView';
import { ReviewStore } from '../src/review/review-store';
import { parseCards } from '../src/cards/parser';
import type { QardServices } from '../src/views/services';
import { ignoresStudyKey } from '../src/review/keyboard';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root, services: QardServices;
const cards = parseCards('<!-- qard-id: first -->\n> [!qard]- Question\n> Answer\n', 'a.md').cards;
const exit = vi.fn();
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  services = {
    host,
    owner: new Component(),
    reviews: new ReviewStore(async () => {}),
    setFocus: vi.fn(),
    isActive: () => true,
    app: { workspace: { on: vi.fn(), offref: vi.fn() } },
    openSource: vi.fn(),
  } as unknown as QardServices;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () =>
    root.render(<StudyView cards={cards} services={services} exit={exit} repeat={vi.fn()} />),
  );
}
async function key(key: string, target: HTMLElement = host) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await services.reviews.flush().catch(() => {});
  });
}
it('requires reveal, rates exactly once, completes every card, and escapes focus on the summary', async () => {
  await mount();
  await key('3');
  expect(services.reviews.getSnapshot().history).toHaveLength(0);
  await key('f');
  expect(services.setFocus).toHaveBeenLastCalledWith(true);
  await key(' ');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('false');
  await act(async () => {
    for (let i = 0; i < 2; i++)
      host.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    await services.reviews.flush().catch(() => {});
  });
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
  expect(host.textContent).toContain('1 / 1');
  await key('Escape');
  expect(services.setFocus).toHaveBeenLastCalledWith(false);
});
it('ignores typing and inactive workspace views', async () => {
  await mount();
  const input = document.createElement('textarea');
  host.append(input);
  await key(' ', input);
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  services.isActive = () => false;
  await key(' ');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  input.remove();
});
it('unmount removes the keyboard listener, render children and focus state', async () => {
  await mount();
  await key('f');
  const remove = vi.spyOn(document, 'removeEventListener');
  await act(async () => root.render(null));
  expect(remove.mock.calls.some((call) => call[0] === 'keydown' && call[2] === true)).toBe(true);
  expect(services.setFocus).toHaveBeenLastCalledWith(false);
  expect((services.owner as unknown as { children: Set<unknown> }).children.size).toBe(0);
  expect(services.app.workspace.offref).toHaveBeenCalled();
});
it('guards rich text, media, modal fields, composition, held keys and shortcuts', () => {
  for (const element of ['input', 'textarea', 'select', 'audio', 'video', 'div']) {
    const target = document.createElement(element);
    if (element === 'div') target.setAttribute('contenteditable', 'true');
    const event = new KeyboardEvent('keydown', { key: ' ' });
    Object.defineProperty(event, 'target', { value: target });
    expect(ignoresStudyKey(event)).toBe(true);
  }
  for (const option of ['repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey'])
    expect(ignoresStudyKey(new KeyboardEvent('keydown', { key: '1', [option]: true }))).toBe(true);
});

it('flips in both directions without exposing hidden links or delaying rapid keyboard input', async () => {
  await mount();
  const front = host.querySelector('.qard-study-front')!,
    back = host.querySelector('.qard-study-back')!;
  expect(back.hasAttribute('inert')).toBe(true);
  await key(' ');
  expect(front.hasAttribute('inert')).toBe(true);
  expect(back.hasAttribute('inert')).toBe(false);
  await key(' ');
  expect(front.hasAttribute('inert')).toBe(false);
  expect(back.hasAttribute('inert')).toBe(true);
  await key(' ');
  expect(host.querySelector('.qard-study-back')).toBe(back);
  expect(host.querySelector('.qard-study-card')?.classList.contains('is-revealed')).toBe(true);
  await key('3');
  expect(host.textContent).toContain('Session complete');
});

it('previews FSRS intervals after reveal without rating the card and hides them with scheduling off', async () => {
  await mount();
  expect(host.querySelectorAll('.qard-rating-interval')).toHaveLength(0);
  await key(' ');
  expect(host.querySelectorAll('.qard-rating-interval')).toHaveLength(4);
  expect(host.querySelectorAll('.qard-rating.with-interval')).toHaveLength(4);
  expect(host.querySelector('[aria-label="Next review in 1 min"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Next review in 10 min"]')).not.toBeNull();
  expect(host.querySelector('.qard-rating-2')?.getAttribute('title')).toBe(
    'I recalled it with effort',
  );
  expect(services.reviews.getSnapshot().history).toHaveLength(0);
  await act(async () =>
    services.reviews.saveSettings({
      ...services.reviews.getSnapshot().settings,
      scheduling: false,
    }),
  );
  expect(host.querySelectorAll('.qard-rating-interval')).toHaveLength(0);
  expect(host.querySelectorAll('.qard-rating.with-interval')).toHaveLength(0);
  await key('3');
  expect(host.textContent).toContain('Session complete');
  expect(services.reviews.getSnapshot().states.first!.fsrs).toBeDefined();
  expect(services.reviews.getSnapshot().states.first!.due).toBeUndefined();
});

it('crams with Space to reveal and Space to advance, without ratings, histories or schedule changes', async () => {
  const many = parseCards(
    '<!-- qard-id: first -->\n> [!qard]- First question\n> First answer\n\n<!-- qard-id: second -->\n> [!qard]- Second question\n> Second answer\n',
    'a.md',
  ).cards;
  await services.reviews.review('first', 4);
  const before = services.reviews.getSnapshot(),
    review = vi.spyOn(services.reviews, 'review'),
    repeat = vi.fn();
  await act(async () =>
    root.render(
      <StudyView cards={many} style="cram" services={services} exit={exit} repeat={repeat} />,
    ),
  );
  await key('3');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  await key(' ');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('false');
  expect(host.querySelector('.qard-ratings')).toBeNull();
  expect(host.querySelector('.qard-rating-interval')).toBeNull();
  await key('4');
  expect(host.textContent).toContain('1 / 2');
  await key(' ');
  expect(host.textContent).toContain('2 / 2');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent?.startsWith('Reveal answer'))!
      .click(),
  );
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent?.startsWith('Next card'))!
      .click(),
  );
  expect(host.textContent).toContain('Cram session complete');
  expect(host.textContent).toContain('2 / 2');
  expect(host.querySelector('.qard-summary-ratings')).toBeNull();
  expect(review).not.toHaveBeenCalled();
  expect(services.reviews.getSnapshot()).toBe(before);
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cram again')!.click(),
  );
  expect(repeat).toHaveBeenCalledWith(many);
});
it('guards cram navigation against held keys, text input, confirmation dialogs and double advance', async () => {
  const many = parseCards(
    '<!-- qard-id: first -->\n> [!qard]- First\n> Answer\n\n<!-- qard-id: second -->\n> [!qard]- Second\n> Answer\n',
    'a.md',
  ).cards;
  await act(async () =>
    root.render(
      <StudyView cards={many} style="cram" services={services} exit={exit} repeat={vi.fn()} />,
    ),
  );
  const field = document.createElement('input');
  host.append(field);
  await key(' ', field);
  field.remove();
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  await key(' ');
  await act(async () => {
    host.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true }));
  });
  expect(host.textContent).toContain('1 / 2');
  await key('Escape');
  await key(' ');
  expect(host.textContent).toContain('1 / 2');
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Keep studying')!.click(),
  );
  await act(async () => {
    for (let i = 0; i < 3; i++)
      host.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  });
  expect(host.textContent).toContain('2 / 2');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  expect(services.reviews.getSnapshot().history).toEqual([]);
});

it('undo works from completion and requires a fresh reveal before rating again', async () => {
  await mount();
  await key(' ');
  await key('3');
  expect(host.textContent).toContain('Session complete');
  await key('u');
  expect(host.textContent).not.toContain('Session complete');
  expect(host.querySelector('.qard-study-back')?.getAttribute('aria-hidden')).toBe('true');
  expect(services.reviews.getSnapshot().states.first).toBeUndefined();
  expect(services.reviews.getSnapshot().history).toEqual([]);
  await key('4');
  expect(services.reviews.getSnapshot().history).toEqual([]);
  await key(' ');
  await key('4');
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
  expect(services.reviews.getSnapshot().history[0]!.rating).toBe(4);
});

it('skip reports no review, leaves the schedule unchanged and offers skipped cards again', async () => {
  const repeat = vi.fn();
  await services.reviews.review('first', 4);
  const before = services.reviews.getSnapshot();
  await act(async () =>
    root.render(<StudyView cards={cards} services={services} exit={exit} repeat={repeat} />),
  );
  await key('s');
  expect(host.textContent).toContain('Session complete');
  expect(host.textContent).toContain('0 / 1');
  expect(host.textContent).toContain('1 card skipped');
  expect(services.reviews.getSnapshot()).toBe(before);
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Review skipped cards')!
      .click(),
  );
  expect(repeat).toHaveBeenCalledWith(cards);
});

it('pause advances a saved session without rating, and does not offer paused cards for repetition', async () => {
  const session = await services.reviews.startSession(cards);
  await act(async () =>
    root.render(
      <StudyView
        cards={cards}
        session={session}
        services={services}
        exit={exit}
        repeat={vi.fn()}
      />,
    ),
  );
  await act(async () => {
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Pause card')!.click();
    await services.reviews.flush().catch(() => {});
  });
  expect(host.textContent).toContain('Session complete');
  expect(host.textContent).not.toContain('Review skipped cards');
  expect(services.reviews.getSnapshot().states.first).toMatchObject({
    paused: true,
    reviewCount: 0,
  });
  expect(services.reviews.getSnapshot().history).toEqual([]);
  expect(services.reviews.getSnapshot().sessions).toEqual([]);
});

it('failed undo keeps the completion screen and failed skip keeps the front card', async () => {
  const write = vi.fn(async () => {});
  services.reviews = new ReviewStore(write);
  const session = await services.reviews.startSession(cards);
  await act(async () =>
    root.render(
      <StudyView
        cards={cards}
        session={session}
        services={services}
        exit={exit}
        repeat={vi.fn()}
      />,
    ),
  );
  write.mockRejectedValueOnce(new Error('disk full'));
  await key('s');
  expect(host.textContent).toContain('disk full');
  expect(host.textContent).not.toContain('Session complete');
  await key(' ');
  await key('3');
  write.mockRejectedValueOnce(new Error('disk full'));
  await key('u');
  expect(host.textContent).toContain('Session complete');
  expect(host.textContent).toContain('disk full');
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
  await key('u');
  expect(host.textContent).not.toContain('Session complete');
  expect(services.reviews.getSnapshot().sessions[0]!.position).toBe(0);
});

it('undo reverses linked-course lapses and offers a separate retry when that course write fails', async () => {
  const restore = vi.fn(async () => {});
  restore.mockRejectedValueOnce(new Error('course disk full'));
  services.learn = { cardLapse: vi.fn(async () => restore) } as unknown as QardServices['learn'];
  await mount();
  await key(' ');
  await key('1');
  await key('u');
  expect(services.reviews.getSnapshot().history).toEqual([]);
  expect(host.textContent).toContain('Rating undone. The linked course could not be restored');
  const retry = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Retry course restoration',
  )!;
  expect(retry.disabled).toBe(false);
  await act(async () => retry.click());
  expect(restore).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain('could not be restored');
  await key(' ');
  await key('3');
  expect(services.reviews.getSnapshot().history).toHaveLength(1);
});
