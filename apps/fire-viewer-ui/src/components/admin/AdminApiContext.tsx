import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AdminApiClient,
  AdminApiError,
  createAdminIdempotencyKey,
  type AdminRequestOptions,
} from '../../lib/adminApi';
import type { AdminSession } from '../../lib/adminSession';

const AdminApiContext = createContext<AdminApiClient | null>(null);

interface AdminApiProviderProps {
  readonly session: AdminSession;
  readonly onUnauthorized: () => void;
  readonly children: ReactNode;
}

export function AdminApiProvider({ session, onUnauthorized, children }: AdminApiProviderProps) {
  const client = useMemo(
    () => new AdminApiClient({ session, onUnauthorized }),
    [onUnauthorized, session],
  );
  return <AdminApiContext.Provider value={client}>{children}</AdminApiContext.Provider>;
}

export function useAdminApi(): AdminApiClient {
  const client = useContext(AdminApiContext);
  if (!client) throw new Error('AdminApiProvider is required for an administration page.');
  return client;
}

export type AdminQueryState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: T }
  | { readonly kind: 'error'; readonly error: unknown };

/**
 * Charge une ressource privée avec annulation et protection contre les
 * réponses tardives d’une navigation précédente.
 */
export function useAdminQuery<T>(
  loader: (options: AdminRequestOptions) => Promise<T>,
  dependencies: readonly unknown[],
): { readonly state: AdminQueryState<T>; readonly reload: () => void } {
  const [reloadIndex, setReloadIndex] = useState(0);
  const [state, setState] = useState<AdminQueryState<T>>({ kind: 'loading' });
  const requestId = useRef(0);

  const reload = useCallback(() => {
    setReloadIndex((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setState({ kind: 'loading' });

    void (async () => {
      // En développement, StrictMode installe puis nettoie immédiatement les
      // effets. Le report au microtask évite d’émettre une requête qui sera
      // nécessairement annulée avant qu’une page admin devienne stable.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      const data = await loader({ signal: controller.signal });
      if (!controller.signal.aborted && requestId.current === currentRequest) {
        setState({ kind: 'ready', data });
      }
    })()
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
        if (requestId.current === currentRequest) setState({ kind: 'error', error });
      });

    return () => controller.abort();
  // `loader` is intentionally declared by page hooks and refreshed with their dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, reloadIndex]);

  return { state, reload };
}

export interface AdminMutationState {
  readonly pending: boolean;
  readonly error: unknown | null;
  readonly succeeded: boolean;
}

/**
 * Conserve la même clé d’idempotence tant que l’intention métier ne change
 * après un échec réseau. Un formulaire modifié crée au contraire une nouvelle
 * intention et donc une nouvelle clé.
 */
export function useAdminMutation(): {
  readonly state: AdminMutationState;
  readonly run: <T>(fingerprint: string, action: (options: AdminRequestOptions) => Promise<T>) => Promise<T | null>;
  readonly clear: () => void;
} {
  const [state, setState] = useState<AdminMutationState>({ pending: false, error: null, succeeded: false });
  const inFlight = useRef(false);
  const pendingIntent = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const clear = useCallback(() => {
    pendingIntent.current = null;
    setState({ pending: false, error: null, succeeded: false });
  }, []);

  const run = useCallback(async <T,>(
    fingerprint: string,
    action: (options: AdminRequestOptions) => Promise<T>,
  ): Promise<T | null> => {
    if (inFlight.current) return null;
    const currentIntent = pendingIntent.current;
    const idempotencyKey = currentIntent?.fingerprint === fingerprint
      ? currentIntent.idempotencyKey
      : createAdminIdempotencyKey();
    pendingIntent.current = { fingerprint, idempotencyKey };
    inFlight.current = true;
    setState({ pending: true, error: null, succeeded: false });
    try {
      const result = await action({ idempotencyKey });
      pendingIntent.current = null;
      setState({ pending: false, error: null, succeeded: true });
      return result;
    } catch (error) {
      setState({ pending: false, error, succeeded: false });
      return null;
    } finally {
      inFlight.current = false;
    }
  }, []);

  return { state, run, clear };
}

export function getSafeAdminError(error: unknown): { readonly message: string; readonly traceId: string | null } {
  if (error instanceof AdminApiError) {
    return { message: error.message, traceId: error.traceId ?? null };
  }
  return {
    message: 'Une erreur locale a empêché cette action. Réessayez ou reconnectez-vous.',
    traceId: null,
  };
}
