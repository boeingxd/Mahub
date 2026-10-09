import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string; // name the action ("End session"), never just "OK"
  onConfirm: () => void;
  onCancel: () => void;
}

// An in-app alert for actions that can't be undone, like Apple's: a short
// title, one sentence, Cancel (focused first, so Enter is safe) and a red
// button that names the action. Uses the browser's <dialog>, so Esc cancels
// and the rest of the page can't be clicked while it's open.
export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="alert" aria-labelledby="alert-title" onCancel={onCancel}>
      <h2 id="alert-title" className="alert-title">
        {title}
      </h2>
      <p className="alert-message">{message}</p>
      <div className="alert-actions">
        <button type="button" className="alert-button" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className="alert-button alert-button-destructive" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
