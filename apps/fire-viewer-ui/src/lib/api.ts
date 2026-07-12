import { demoIncident } from '../fixtures/demoIncident';
import type { IncidentData } from '../types';
import { VIEWER_MANIFEST_FIRE_ID_RE } from './viewerManifest';

export class IncidentApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'IncidentApiError';
  }
}

export function isValidFireId(value: string): boolean {
  return VIEWER_MANIFEST_FIRE_ID_RE.test(value);
}

function validateIncidentData(value: unknown): IncidentData {
  if (!value || typeof value !== 'object') {
    throw new IncidentApiError('Réponse API invalide.');
  }

  const candidate = value as Partial<IncidentData>;
  if (
    candidate.schemaVersion !== '2.0' ||
    typeof candidate.fireId !== 'string' ||
    typeof candidate.episodeId !== 'string' ||
    !candidate.asset ||
    !candidate.frame ||
    !candidate.status
  ) {
    throw new IncidentApiError('Le manifeste ne respecte pas le schéma attendu.');
  }

  return candidate as IncidentData;
}

function cloneDemo(fireId: string): IncidentData {
  return {
    ...structuredClone(demoIncident),
    fireId,
  };
}

export async function loadIncident(
  fireId: string,
  externalSignal?: AbortSignal,
): Promise<IncidentData> {
  if (!isValidFireId(fireId)) {
    throw new IncidentApiError('Identifiant incident invalide.', 400);
  }

  const useMocks = import.meta.env.VITE_USE_MOCKS !== 'false';
  if (useMocks) {
    await new Promise((resolve) => window.setTimeout(resolve, 280));
    return cloneDemo(fireId);
  }

  const baseUrl = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new IncidentApiError('VITE_API_BASE_URL doit être défini lorsque les mocks sont désactivés.');
  }

  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), 8_000);
  const onAbort = () => timeoutController.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(`${baseUrl}/incident/${encodeURIComponent(fireId)}`, {
      signal: timeoutController.signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    });

    if (!response.ok) {
      throw new IncidentApiError(
        response.status === 404
          ? 'Incident introuvable.'
          : `Erreur API (${response.status}).`,
        response.status,
      );
    }

    return validateIncidentData(await response.json());
  } catch (error) {
    if (error instanceof IncidentApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new IncidentApiError('Le chargement de l’incident a dépassé le délai autorisé.');
    }
    throw new IncidentApiError('Impossible de joindre le service incident.');
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}
