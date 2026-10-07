import { useRef, useState } from 'react';
import { TextCursorInput } from 'lucide-react';
import { clozeGroups, renderCloze } from '../cards/card-format';

function canHide(selected: string) {
  const blank = `{{c1::${selected}}}`;
  return (
    !!selected.trim() &&
    !/[\r\n]/.test(selected) &&
    clozeGroups(blank).includes(1) &&
    renderCloze(blank, 1, true) === selected
  );
}

export function ClozeEditor({ text, change }: { text: string; change: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState(false);
  const groups = clozeGroups(text);
  function hideSelection() {
    const el = ref.current;
    if (!el || el.selectionStart === el.selectionEnd) {
      return;
    }
    const start = el.selectionStart,
      end = el.selectionEnd;
    const selected = text.slice(start, end);
    if (!canHide(selected)) {
      return;
    }
    const group = (groups[groups.length - 1] || 0) + 1;
    if (group > 999) {
      return;
    }
    const wrapped = `{{c${group}::${selected}}}`;
    change(text.slice(0, start) + wrapped + text.slice(end));
    setSelection(false);
    el.ownerDocument.defaultView?.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + wrapped.length, start + wrapped.length);
    });
  }
  return (
    <div className="qard-cloze-editor">
      <label>
        Text
        <textarea
          ref={ref}
          required
          value={text}
          onChange={(e) => change(e.target.value)}
          onSelect={(e) => {
            const el = e.currentTarget;
            const selected = text.slice(el.selectionStart, el.selectionEnd);
            setSelection(canHide(selected));
          }}
          rows={6}
          placeholder="Write a sentence, select the words to recall, then choose Hide selection."
        />
      </label>
      <div className="qard-format-tools">
        <button type="button" disabled={!selection} onClick={hideSelection}>
          <TextCursorInput size={15} />
          Hide selection
        </button>
        <span className="qard-muted">
          {groups.length
            ? `${groups.length} ${groups.length === 1 ? 'card' : 'cards'}`
            : 'Select a word or phrase to make a blank'}
        </span>
      </div>
      <p className="qard-muted">
        Each number makes a separate card. Reuse a number to hide words together. Add a hint with{' '}
        <code>{'{{c1::answer::hint}}'}</code>.
      </p>
    </div>
  );
}
