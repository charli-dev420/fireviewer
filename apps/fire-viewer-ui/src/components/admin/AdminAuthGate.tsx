import { FormEvent, useMemo, useState, type ReactNode } from 'react';
import {
  buildAdminAuthorizationHeader,
  clearAdminSession,
  loadAdminSession,
  saveAdminSession,
  validateAdminToken,
  type AdminSession,
} from '../../lib/adminSession';

interface AdminAuthGateProps {
  children: (session: AdminSession, onSignOut: () => void) => ReactNode;
}

function formatExpiration(expiresAt: string | null): string {
  if (!expiresAt) return 'expiration non fournie';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(expiresAt));
}

export function AdminAuthGate({ children }: AdminAuthGateProps) {
  const initialSession = useMemo(() => loadAdminSession(), []);
  const [session, setSession] = useState<AdminSession | null>(initialSession);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const signOut = () => {
    clearAdminSession();
    setSession(null);
    setToken('');
    setError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateAdminToken(token);
    if (!validation.ok) {
      setError(validation.reason);
      return;
    }
    saveAdminSession(validation.session);
    setSession(validation.session);
    setToken('');
    setError(null);
  };

  if (session) {
    return (
      <>
        <div className="admin-auth-state" role="status">
          <div>
            <strong>Session administrateur active</strong>
            <span>{session.subject} · {formatExpiration(session.expiresAt)}</span>
          </div>
          <code>{buildAdminAuthorizationHeader(session).slice(0, 18)}…</code>
          <button type="button" className="button button--small" onClick={signOut}>Se déconnecter</button>
        </div>
        {children(session, signOut)}
      </>
    );
  }

  return (
    <main className="error-screen" aria-labelledby="admin-login-title">
      <form className="error-screen__card" onSubmit={submit}>
        <span className="eyebrow">Accès privé</span>
        <h1 id="admin-login-title">Connexion administrateur requise</h1>
        <p>
          Collez un bearer JWT contenant le rôle <code>administrator</code>. Le backend reste l’autorité :
          chaque future requête privée devra envoyer ce jeton dans l’en-tête <code>Authorization</code>.
        </p>
        <label htmlFor="admin-token">Bearer JWT administrateur</label>
        <textarea
          id="admin-token"
          value={token}
          onChange={(event) => setToken(event.currentTarget.value)}
          rows={5}
          autoComplete="off"
          spellCheck={false}
        />
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" className="button button--primary">Ouvrir l’administration</button>
      </form>
    </main>
  );
}
