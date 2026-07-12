import type { IncidentData, LayerVisibility, ViewId, ViewerState } from '../types';
import { MobileIncidentSheet } from './MobileIncidentSheet';
import { SituationPanel } from './SituationPanel';
import { SynthesisPanel } from './SynthesisPanel';
import { TerrainViewer } from './TerrainViewer';

interface ViewerWorkspaceProps {
  incident: IncidentData;
  layers: LayerVisibility;
  viewerState: ViewerState;
  activeVersion: number;
  activeHash: string;
  offline: boolean;
  updateProgress: number | null;
  onLayerChange: (key: keyof LayerVisibility, value: boolean) => void;
  onNavigate: (view: ViewId) => void;
  onCopyLink: () => void;
  onOpenTextView: () => void;
  onNotify: (message: string, tone?: 'success' | 'info' | 'warning') => void;
}

export function ViewerWorkspace({
  incident,
  layers,
  viewerState,
  activeVersion,
  activeHash,
  offline,
  updateProgress,
  onLayerChange,
  onNavigate,
  onCopyLink,
  onOpenTextView,
  onNotify,
}: ViewerWorkspaceProps) {
  return (
    <section
      id="panel-viewer"
      role="tabpanel"
      aria-labelledby="tab-viewer"
      className="viewer-workspace"
      tabIndex={-1}
    >
      <SituationPanel
        incident={incident}
        viewerState={viewerState}
        offline={offline}
        onCopyLink={onCopyLink}
        onOpenTextView={onOpenTextView}
      />
      <TerrainViewer
        incident={incident}
        layers={layers}
        viewerState={viewerState}
        activeVersion={activeVersion}
        activeHash={activeHash}
        updateProgress={updateProgress}
        onOpenTextView={onOpenTextView}
        onNotify={onNotify}
      />
      <SynthesisPanel
        incident={incident}
        layers={layers}
        viewerState={viewerState}
        activeVersion={activeVersion}
        activeHash={activeHash}
        onLayerChange={onLayerChange}
        onOpenSources={() => onNavigate('sources')}
      />
      <MobileIncidentSheet
        incident={incident}
        activeVersion={activeVersion}
        layers={layers}
        offline={offline}
        onLayerChange={onLayerChange}
        onNavigate={onNavigate}
        onOpenTextView={onOpenTextView}
      />
    </section>
  );
}
