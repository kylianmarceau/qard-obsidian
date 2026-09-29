export function ignoresStudyKey(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target as Element | null;
  return !!target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], audio, video, [data-qard-keyboard-ignore], .modal-container, .suggestion-container');
}
