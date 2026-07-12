import { useEffect } from 'react';
import { Icon } from './Icons';

interface ToastProps {
  message: string | null;
  tone?: 'success' | 'info' | 'warning';
  onDismiss: () => void;
}

export function Toast({ message, tone = 'info', onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 4_200);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className={`toast toast--${tone}`} role="status" aria-live="polite">
      <span className="toast__icon">
        <Icon name={tone === 'success' ? 'check' : tone === 'warning' ? 'warning' : 'info'} size={18} />
      </span>
      <span>{message}</span>
      <button type="button" className="toast__close" aria-label="Fermer la notification" onClick={onDismiss}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
