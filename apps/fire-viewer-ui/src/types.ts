export type IncidentStatusCode =
  | 'CANDIDATE'
  | 'REVIEW'
  | 'ACTIVE_CONFIRMED'
  | 'MONITORING'
  | 'EXTINGUISHED'
  | 'CLOSED'
  | 'SUSPENDED';

export type ViewerState =
  | 'INITIALIZING'
  | 'METADATA_READY'
  | 'MODEL_LOADING'
  | 'READY'
  | 'DEGRADED'
  | 'ERROR';

export type ViewId = 'viewer' | 'sources' | 'history' | 'journal';

export type EvidenceState = 'verified' | 'review' | 'rejected' | 'reference';

export interface IncidentStatus {
  code: IncidentStatusCode;
  label: string;
  validatedAt: string;
  validatedBy: string;
}

export interface Freshness {
  incidentAt: string;
  positionAt: string;
  perimeterAt: string;
  terrainSourceYear: number;
  lastSyncAt: string;
}

export interface AssetManifest {
  assetId: string;
  version: number;
  hash: string;
  sizeBytes: number;
  lod: 'mobile' | 'desktop';
  url: string;
  publishedAt: string;
  source: string;
  sourceYear: number;
  triangles: number;
  footprint: string;
  verticalDatum: string;
}

export interface GeoFrame {
  originWgs84: [number, number, number];
  localFrame: 'ENU';
  metersPerUnit: 1;
  horizontalUncertaintyM: number;
}

export interface IncidentAlert {
  id: string;
  title: string;
  detail: string;
  at: string;
  tone: 'warning' | 'info' | 'success' | 'critical';
}

export interface Observation {
  id: string;
  time: string;
  type: string;
  source: string;
  sourceDetail: string;
  location: string;
  uncertainty: string;
  uncertaintyMeters?: number;
  state: EvidenceState;
  stateLabel: string;
  observedAt: string;
  receivedAt: string;
  confidence: number | null;
  summary: string;
  provenance: string;
}

export interface ScoreFactor {
  id: string;
  label: string;
  value: number;
  explanation: string;
}

export interface ModelVersion {
  version: number;
  hash: string;
  status: 'current' | 'archived' | 'quarantined';
  publishedAt: string;
  label: string;
  triangles: number;
  sizeMb: number;
  footprint: string;
  origin: string;
  altitude: string;
  source: string;
  validation: string;
  changeNote: string;
}

export interface Episode {
  id: string;
  title: string;
  status: 'active' | 'monitoring' | 'closed';
  statusLabel: string;
  startedAt: string;
  endedAt?: string;
  note: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  category: 'observation' | 'status' | 'asset' | 'security' | 'system';
  title: string;
  description: string;
  actor: string;
  traceId: string;
  outcome: 'success' | 'warning' | 'info' | 'blocked';
}

export interface IncidentData {
  schemaVersion: '2.0';
  fireId: string;
  episodeId: string;
  canonicalName: string;
  sector: string;
  status: IncidentStatus;
  freshness: Freshness;
  asset: AssetManifest;
  frame: GeoFrame;
  locationLabel: string;
  confidence: number;
  confidenceLabel: string;
  factors: ScoreFactor[];
  alerts: IncidentAlert[];
  observations: Observation[];
  episodes: Episode[];
  versions: ModelVersion[];
  audit: AuditEvent[];
  publicNotice: string;
}

export interface LayerVisibility {
  shadedTerrain: boolean;
  contourLines: boolean;
  observations: boolean;
  uncertainty: boolean;
  symbolicParticles: boolean;
}
