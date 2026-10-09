import { useEffect, useRef } from 'react';

export interface SheetAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean; // red, for actions that undo something
}

interface ActionSheetProps {
  open: boolean;
  title: string; // who or what the actions apply to, e.g. "Student Two"
  message?: string;
  actions: SheetAction[];
  onCancel: () => void;
}

// A short list of choices for one thing, like iOS's action sheet: it rises
// from the bottom on a phone and sits in the middle on a laptop. Cancel is
// always separate at the bottom. Uses the browser's <dialog>, so Esc cancels.
export function ActionSheet({ open, title, message, actions, onCancel }: ActionSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onCancel={onCancel}
      // A click on the dim backdrop (outside the sheet) also cancels.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="sheet-group">
        <div className="sheet-head">
          <h2 id="sheet-title" className="sheet-title">
            {title}
          </h2>
          {message && <p className="sheet-message">{message}</p>}
        </div>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={a.destructive ? 'sheet-button sheet-button-destructive' : 'sheet-button'}
            onClick={a.onSelect}
          >
            {a.label}
          </button>
        ))}
      </div>
      <button type="button" className="sheet-button sheet-cancel" onClick={onCancel} autoFocus>
        Cancel
      </button>
    </dialog>
  );
}
