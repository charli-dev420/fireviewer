import type { ReactNode } from 'react';
import { Icon } from '../Icons';
import { getSafeAdminError } from './AdminApiContext';

export function AdminPageHeader({ title, children, actions }: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <div>
        <span className="eyebrow">Administration privée</span>
        <h2>{title}</h2>
        {children ? <div className="admin-page-header__description">{children}</div> : null}
      </div>
      {actions ? <div className="admin-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function AdminLoadingState({ label = 'Chargement des données privées…' }: { readonly label?: string }) {
  return (
    <div className="admin-page-state" role="status" aria-live="polite">
      <Icon name="refresh" size={20} />
      <span>{label}</span>
    </div>
  );
}

export function AdminErrorState({ error, onRetry }: { readonly error: unknown; readonly onRetry?: () => void }) {
  const safe = getSafeAdminError(error);
  return (
    <div className="admin-page-state admin-page-state--error" role="alert">
      <Icon name="warning" size={20} />
      <div>
        <strong>Action indisponible</strong>
        <p>{safe.message}</p>
        {safe.traceId ? <p>Code de suivi : <code>{safe.traceId}</code></p> : null}
        {onRetry ? <button type="button" className="button button--small" onClick={onRetry}>Réessayer</button> : null}
      </div>
    </div>
  );
}

export function AdminEmptyState({ title, children, action }: {
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="admin-empty-state">
      <Icon name="info" size={22} />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
        {action ? <div className="admin-empty-state__action">{action}</div> : null}
      </div>
    </div>
  );
}

export function AdminMutationFeedback({ error, succeeded, success }: {
  readonly error: unknown | null;
  readonly succeeded: boolean;
  readonly success: string;
}) {
  if (error) {
    const safe = getSafeAdminError(error);
    return (
      <div className="admin-feedback admin-feedback--error" role="alert">
        <Icon name="warning" size={17} />
        <span>{safe.message}{safe.traceId ? ` Code de suivi : ${safe.traceId}.` : ''}</span>
      </div>
    );
  }
  if (!succeeded) return null;
  return (
    <div className="admin-feedback admin-feedback--success" role="status">
      <Icon name="check" size={17} />
      <span>{success}</span>
    </div>
  );
}

export function AdminStateLabel({ value }: { readonly value: string }) {
  const tone = value === 'PUBLISHED' || value === 'VALIDATED' || value === 'APPROVED'
    ? 'success'
    : value === 'HIDDEN' || value === 'REJECTED' || value === 'ARCHIVED'
      ? 'danger'
      : value === 'PENDING' || value === 'PENDING_REVIEW' || value === 'VALIDATING'
        ? 'warning'
        : 'neutral';
  return <span className={`admin-state admin-state--${tone}`}>{value.replaceAll('_', ' ')}</span>;
}

export function formatAdminDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(value));
}
