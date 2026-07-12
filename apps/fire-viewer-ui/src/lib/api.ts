import { demoIncident } from '../fixtures/demoIncident';
import type { IncidentData } from '../types';
import { VIEWER_MANIFEST_FIRE_ID_RE } from './viewerManifest';

/**
 * Erreur du parcours de démonstration uniquement. Le client public réel est
 * dans `manifestClient.ts` et ne connaît ni ce type ni le fixture.
 */
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

function cloneDemo(fireId: string): IncidentData {
  return {
    ...structuredClone(demoIncident),
    fireId,
  };
}

function mockDelay(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Le chargement fictif a été annulé.', 'AbortError'));
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, 280);
    const onAbort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException('Le chargement fictif a été annulé.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Charge le dashboard riche fictif. Cette fonction ne réalise aucune requête
 * HTTP, quel que soit l'environnement ; elle ne peut donc jamais atteindre
 * l'ancien endpoint `/incident/{fire_id}`.
 */
export async function loadMockIncident(
  fireId: string,
  externalSignal?: AbortSignal,
): Promise<IncidentData> {
  if (!isValidFireId(fireId)) {
    throw new IncidentApiError('Identifiant incident invalide.', 400);
  }
  await mockDelay(externalSignal);
  return cloneDemo(fireId);
}

/** Compatibilité transitoire : le nom historique reste exclusivement mock-only. */
export const loadIncident = loadMockIncident;
