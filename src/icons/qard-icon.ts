// The original Flip mark uses the same geometry in Obsidian and the workspace.
export const QARD_ICON_PATHS = [
  'm14.2 7-9.5 2.1a2 2 0 0 0-1.5 2.4l1.6 7.2a2 2 0 0 0 2.4 1.5l11.7-2.6a2 2 0 0 0 1.5-2.4l-.6-2.8',
  'm7.8 13.3 5.8-1.3M13 3c4.4 0 7.7 2.5 8 6M18.1 7.6 21 9l1-3',
] as const;

// Obsidian registers icons in a 100 × 100 viewBox; the design uses 24 × 24.
export const QARD_OBSIDIAN_ICON = `<g transform="scale(${100 / 24})" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${QARD_ICON_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>`;
