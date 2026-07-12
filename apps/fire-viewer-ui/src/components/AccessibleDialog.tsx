import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icons';

interface AccessibleDialogProps {
  open: boolean;
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'medium' | 'large';
}

export function AccessibleDialog({
  open,
  title,
  eyebrow,
  onClose,
  children,
  size = 'medium',
}: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const handleClose = () => {
      if (open) onClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
    };
  }, [onClose, open]);

  return (
    <dialog
      ref={dialogRef}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="dialog__surface">
        <header className="dialog__header">
          <div>
            {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Fermer" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog__body">{children}</div>
      </div>
    </dialog>
  );
}
