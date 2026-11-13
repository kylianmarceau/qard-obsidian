// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DeckBadge } from '../src/components/DeckBadge';

let host: HTMLElement, root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (icon?: string, color?: string, name = 'Biology') =>
  act(() => root.render(<DeckBadge name={name} icon={icon} color={color} />));
const badge = () => host.querySelector<HTMLElement>('.qard-deck-badge')!;

it('updates owned host icons and independently resets icon and color to automatic', () => {
  render('terminal', '#123456');
  expect(badge().getAttribute('aria-hidden')).toBe('true');
  expect(badge().style.getPropertyValue('--qard-course')).toBe('#123456');
  expect(host.querySelectorAll('svg')).toHaveLength(1);
  expect(host.querySelector('svg')?.getAttribute('data-icon')).toBe('terminal');
  const previous = host.querySelector('svg')!;
  render('network', '#123456');
  expect(previous.isConnected).toBe(false);
  expect(host.querySelectorAll('svg')).toHaveLength(1);
  expect(host.querySelector('svg')?.getAttribute('data-icon')).toBe('network');
  render(undefined, '#123456');
  expect(host.querySelector('[data-icon]')).toBeNull();
  expect(host.querySelector('svg')).not.toBeNull();
  expect(badge().style.getPropertyValue('--qard-course')).toBe('#123456');
  render('terminal');
  expect(host.querySelector('svg')?.getAttribute('data-icon')).toBe('terminal');
  expect(badge().style.getPropertyValue('--qard-course')).toBe('');
});

it('falls back for unavailable icons and invalid colors without losing the other choice', () => {
  render('not-on-this-device', '#aabbcc', 'Unknown subject');
  expect(badge().textContent).toBe('US');
  expect(badge().style.getPropertyValue('--qard-course')).toBe('#aabbcc');
  render('terminal', '#aabbcc', 'Unknown subject');
  render(undefined, '#aabbcc', 'Unknown subject');
  expect(badge().textContent).toBe('US');
  render('terminal', 'url(https://example.com)');
  expect(host.querySelector('svg')?.getAttribute('data-icon')).toBe('terminal');
  expect(badge().style.getPropertyValue('--qard-course')).toBe('');
});

it('gives simultaneous badges separate SVG nodes and removes them on unmount', () => {
  act(() =>
    root.render(
      <>
        <DeckBadge name="A" icon="terminal" />
        <DeckBadge name="B" icon="terminal" />
      </>,
    ),
  );
  const icons = [...host.querySelectorAll('svg')];
  expect(icons).toHaveLength(2);
  expect(icons[0]).not.toBe(icons[1]);
  act(() => root.render(null));
  expect(icons.every((icon) => !icon.isConnected)).toBe(true);
});
