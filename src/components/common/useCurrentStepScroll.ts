import { useEffect, useRef } from 'react';

/** Reveal a changed step inside its strip without scrolling the surrounding page. */
export function useCurrentStepScroll(index: number | undefined, visible = true) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = ref.current,
      current = strip?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!visible || index === undefined || !strip?.clientWidth || !current) {
      return;
    }
    const bounds = strip.getBoundingClientRect(),
      item = current.getBoundingClientRect(),
      left = bounds.left + strip.clientLeft,
      right = left + strip.clientWidth;
    if (item.left < left || item.width > strip.clientWidth) {
      strip.scrollLeft += item.left - left;
    } else if (item.right > right) {
      strip.scrollLeft += item.right - right;
    }
  }, [index, visible]);
  return ref;
}
