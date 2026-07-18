import type { PublicIconName } from '../../public/PublicIcon';

export interface AdminOperationDefinition {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly group: 'pilotage' | 'operations' | 'production' | 'governance';
  readonly icon: PublicIconName;
  readonly availability: 'available' | 'not_available';
  readonly description: string;
}

/** Seules les opérations dotées d'un contrat réel sont exposées dans la navigation. */
export const ADMIN_OPERATIONS: readonly AdminOperationDefinition[] = [
  { id: 'dashboard', label: 'Centre opérationnel', href: '/admin', group: 'pilotage', icon: 'map', availability: 'available', description: 'Vue nationale des incidents et décisions prioritaires.' },
  { id: 'operational-map', label: 'Carte opérationnelle', href: '/admin/carte-operationnelle', group: 'pilotage', icon: 'map', availability: 'available', description: 'Carte nationale interne des incidents et représentations 3D.' },
  { id: 'work-queue', label: 'Validation', href: '/admin/validation', group: 'pilotage', icon: 'data', availability: 'available', description: 'Tout ce qui attend une décision humaine.' },
  { id: 'incidents', label: 'Incidents', href: '/admin/incidents', group: 'operations', icon: 'flame', availability: 'available', description: 'Dossiers fire_id, épisodes, observations, modèles et audit.' },
  { id: 'spatial-matching', label: 'Rapprochement spatial', href: '/admin/rapprochement-spatial', group: 'operations', icon: 'target', availability: 'available', description: 'Revue motivée des candidats fire_id et episode_id proposés.' },
  { id: 'reports', label: 'Signalements', href: '/admin/signalements', group: 'operations', icon: 'users', availability: 'available', description: 'Traitement audité des erreurs signalées par le public.' },
  { id: 'publications', label: 'Publications', href: '/admin/publications', group: 'operations', icon: 'share', availability: 'available', description: 'Registre, retrait et restauration auditables des packages publiés.' },
  { id: 'audit', label: 'Audit global', href: '/admin/audit', group: 'governance', icon: 'data', availability: 'available', description: 'Journal global append-only sans snapshots exposés.' },
  { id: 'roles', label: 'Rôles et accès', href: '/admin/roles', group: 'governance', icon: 'users', availability: 'available', description: 'Rôles effectifs du jeton et catalogue serveur.' },
  { id: 'system', label: 'Système', href: '/admin/systeme', group: 'governance', icon: 'monitor', availability: 'available', description: 'Files, modèles, erreurs, accès et réglages.' },
  { id: 'configuration', label: 'Configuration', href: '/admin/configuration', group: 'governance', icon: 'data', availability: 'available', description: 'Paramètres sûrs consultables, sans secret ni mutation locale.' },
] as const;

/** Références spatiales techniques, distinctes de l’identité incidente. */
export const ADMIN_ZONE_TOOLS: readonly AdminOperationDefinition[] = [
  { id: 'zones', label: 'Cartes 3D', href: '/admin/zones', group: 'production', icon: 'database', availability: 'available', description: 'Consulter les fonds 3D déjà importés.' },
  { id: 'new-zone', label: 'Ajouter une carte', href: '/admin/zones/nouvelle', group: 'production', icon: 'plus-circle', availability: 'available', description: 'Choisir l’incident puis importer son fond 3D.' },
] as const;

export function findAdminOperationByPath(pathname: string): AdminOperationDefinition | null {
  return ADMIN_OPERATIONS.find((operation) => operation.href === pathname) ?? null;
}

export function isAdminPathActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin' || pathname === '/admin/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function resolveActiveAdminPath(pathname: string): string | null {
  const matching = [...ADMIN_OPERATIONS, ...ADMIN_ZONE_TOOLS]
    .filter((operation) => isAdminPathActive(pathname, operation.href))
    .sort((left, right) => right.href.length - left.href.length);

  return matching[0]?.href ?? null;
}
