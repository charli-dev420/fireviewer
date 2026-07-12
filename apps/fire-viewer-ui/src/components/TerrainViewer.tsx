import { useMemo, useState } from 'react';
import type { IncidentData, LayerVisibility, ViewerState } from '../types';
import { Icon } from './Icons';

interface TerrainViewerProps {
  incident: IncidentData;
  layers: LayerVisibility;
  viewerState: ViewerState;
  activeVersion: number;
  activeHash: string;
  updateProgress: number | null;
  onOpenTextView: () => void;
  onNotify: (message: string, tone?: 'success' | 'info' | 'warning') => void;
}

interface Marker {
  id: string;
  x: number;
  y: number;
  label: string;
  detail: string;
}

const markers: Marker[] = [
  { id: 'P-184', x: 370, y: 282, label: 'Photo témoin P-184', detail: 'Vérifiée · ± 180 m · 10:22' },
  { id: 'C-12', x: 652, y: 348, label: 'Capteur C-12', detail: 'Vérifié · ± 90 m · 10:18' },
  { id: 'P-179', x: 575, y: 514, label: 'Photo réseau P-179', detail: 'À examiner · ± 620 m · 10:08' },
];

export function TerrainViewer({
  incident,
  layers,
  viewerState,
  activeVersion,
  activeHash,
  updateProgress,
  onOpenTextView,
  onNotify,
}: TerrainViewerProps) {
  const [measureActive, setMeasureActive] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<Marker | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [northAligned, setNorthAligned] = useState(true);

  const perimeterPath = useMemo(
    () =>
      activeVersion >= 5
        ? 'M432 360 L505 326 L595 349 L641 403 L625 472 L537 486 L463 454 L410 409 Z'
        : 'M432 365 L505 326 L584 351 L628 394 L618 463 L541 479 L465 451 L414 407 Z',
    [activeVersion],
  );

  const handleRecenter = () => {
    setCameraKey((value) => value + 1);
    setSelectedMarker(null);
    onNotify('Vue recentrée sur la géométrie de référence.', 'info');
  };

  const handleNorth = () => {
    setNorthAligned((value) => !value);
    onNotify(northAligned ? 'Orientation libre activée.' : 'Vue réalignée vers le nord.', 'info');
  };

  const handleMeasure = () => {
    setMeasureActive((value) => !value);
    onNotify(measureActive ? 'Mesure désactivée.' : 'Mesure activée : segment de démonstration 742 m.', 'info');
  };

  if (viewerState === 'DEGRADED' || viewerState === 'ERROR') {
    return (
      <section className="terrain-card terrain-card--degraded" aria-labelledby="terrain-degraded-title">
        <div className="degraded-map" aria-hidden="true">
          <div className="degraded-map__grid" />
          <span className="degraded-map__uncertainty" />
          <span className="degraded-map__zone" />
          <span className="degraded-map__marker degraded-map__marker--one" />
          <span className="degraded-map__marker degraded-map__marker--two" />
        </div>
        <div className="degraded-panel">
          <span className="degraded-panel__icon">
            <Icon name="text" size={28} />
          </span>
          <div>
            <div className="eyebrow">Mode dégradé sûr</div>
            <h2 id="terrain-degraded-title">La 3D est indisponible, les informations critiques restent accessibles.</h2>
            <p>
              Position de référence {incident.locationLabel}, incertitude ± {incident.frame.horizontalUncertaintyM} m.
              Le modèle courant v{activeVersion} n’est pas utilisé pour masquer ou remplacer ces données textuelles.
            </p>
          </div>
          <button type="button" className="button button--primary" onClick={onOpenTextView}>
            <Icon name="text" size={18} />
            Ouvrir la vue texte
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="terrain-card" aria-label="Visualisation du terrain et des observations">
      <div className="terrain-toolbar" role="toolbar" aria-label="Contrôles de la visualisation">
        <button type="button" className="viewer-button" onClick={handleRecenter}>
          <Icon name="refresh" size={18} />
          Recentrer
        </button>
        <button
          type="button"
          className={`viewer-button ${northAligned ? 'is-active' : ''}`}
          aria-pressed={northAligned}
          onClick={handleNorth}
        >
          <Icon name="north" size={18} />
          Nord
        </button>
        <button
          type="button"
          className={`viewer-button ${measureActive ? 'is-active' : ''}`}
          aria-pressed={measureActive}
          onClick={handleMeasure}
        >
          <Icon name="measure" size={18} />
          Mesurer
        </button>
      </div>

      <div className="terrain-badge" aria-label="Avertissement sur le rendu">
        <Icon name="info" size={15} />
        Terrain daté {incident.freshness.terrainSourceYear} · représentation symbolique
      </div>

      <div className="compass" aria-label={northAligned ? 'Vue orientée au nord' : 'Orientation libre'}>
        <span className="compass__n">N</span>
        <Icon name="compass" size={52} />
      </div>

      <svg
        key={cameraKey}
        className={`terrain-svg ${northAligned ? 'is-north' : 'is-free'}`}
        viewBox="0 0 920 650"
        role="img"
        aria-labelledby="terrain-title terrain-description"
      >
        <title id="terrain-title">Terrain de contexte pour l’incident {incident.fireId}</title>
        <desc id="terrain-description">
          Relief daté de 2024, périmètre estimé en orange, ellipse d’incertitude en pointillés et trois observations.
        </desc>
        <defs>
          <linearGradient id="terrainBackground" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#173e3f" />
            <stop offset="55%" stopColor="#245e58" />
            <stop offset="100%" stopColor="#123332" />
          </linearGradient>
          <linearGradient id="mountainFront" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f6d66" />
            <stop offset="100%" stopColor="#173f3c" />
          </linearGradient>
          <linearGradient id="mountainBack" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4e827b" stopOpacity="0.78" />
            <stop offset="100%" stopColor="#275650" stopOpacity="0.68" />
          </linearGradient>
          <linearGradient id="perimeterFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#b9792d" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#8c4d21" stopOpacity="0.88" />
          </linearGradient>
          <filter id="markerShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#071426" floodOpacity="0.45" />
          </filter>
          <filter id="zoneGlow" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#ef6a1d" floodOpacity="0.35" />
          </filter>
          <pattern id="gridPattern" width="72" height="72" patternUnits="userSpaceOnUse">
            <path d="M72 0H0V72" fill="none" stroke="#d8e8df" strokeOpacity="0.05" strokeWidth="1" />
          </pattern>
        </defs>

        <rect width="920" height="650" fill="url(#terrainBackground)" />
        <rect width="920" height="650" fill="url(#gridPattern)" />

        {layers.shadedTerrain ? (
          <g className="terrain-relief">
            <path d="M0 420 148 206 276 365 423 122 577 370 715 185 920 397V650H0Z" fill="url(#mountainBack)" />
            <path d="M0 544 171 326 314 513 478 288 645 524 784 332 920 482V650H0Z" fill="url(#mountainFront)" />
            <path d="M0 650 203 445 339 590 506 402 706 622 831 470 920 563V650Z" fill="#153b38" />
            <path d="M0 650 248 523 392 650Z" fill="#0f302e" />
            <path d="M398 650 584 511 751 650Z" fill="#123432" />
            <path d="M676 650 824 547 920 650Z" fill="#0c2c2b" />
          </g>
        ) : (
          <rect width="920" height="650" fill="#1a4845" />
        )}

        {layers.contourLines ? (
          <g className="contour-lines" fill="none" stroke="#b5d0c7" strokeOpacity="0.28" strokeWidth="1.25">
            <path d="M-40 96C115 144 230 98 372 82s254 28 402 7 225 15 245 26" />
            <path d="M-40 132C122 176 228 126 382 112s255 35 410 12 214 17 237 28" />
            <path d="M-40 171C104 212 226 157 379 147s261 30 414 12 212 15 246 34" />
            <path d="M-40 214C94 244 211 196 371 190s260 28 417 11 212 11 245 31" />
            <path d="M-40 256C117 281 221 234 383 232s252 26 410 15 210 10 246 29" />
            <path d="M-40 301C102 323 225 275 374 280s266 17 419 12 201 5 238 25" />
            <path d="M-40 346C102 365 218 322 381 326s258 22 412 14 206 5 242 26" />
            <path d="M-40 393C116 408 217 368 378 372s266 19 420 11 204 8 239 23" />
            <path d="M-40 442C105 455 224 416 380 422s262 22 411 16 210 8 245 22" />
            <path d="M-40 492C111 506 223 468 384 472s256 24 410 19 209 7 244 24" />
            <path d="M-40 544C102 559 224 520 381 526s263 20 414 18 203 6 239 22" />
          </g>
        ) : null}

        {layers.uncertainty ? (
          <ellipse
            cx="525"
            cy="402"
            rx="154"
            ry="115"
            fill="#d9c97b"
            fillOpacity="0.05"
            stroke="#e7d987"
            strokeWidth="3"
            strokeDasharray="10 9"
          />
        ) : null}

        <path
          d={perimeterPath}
          fill="url(#perimeterFill)"
          stroke="#d99748"
          strokeWidth="2.5"
          filter="url(#zoneGlow)"
          className="perimeter-shape"
        />

        {layers.symbolicParticles ? (
          <g className="symbolic-particles" aria-label="Particules symboliques, sans valeur physique">
            <circle cx="513" cy="348" r="5" fill="#f5691a" />
            <circle cx="546" cy="365" r="4" fill="#ffd177" />
            <circle cx="575" cy="386" r="6" fill="#e64e12" />
            <circle cx="497" cy="393" r="4" fill="#ffb240" />
            <circle cx="563" cy="430" r="5" fill="#f5691a" />
          </g>
        ) : null}

        {layers.observations ? (
          <g className="observation-markers">
            {markers.map((marker) => (
              <g
                key={marker.id}
                className={`observation-marker ${selectedMarker?.id === marker.id ? 'is-selected' : ''}`}
                transform={`translate(${marker.x} ${marker.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${marker.label}, ${marker.detail}`}
                onClick={() => setSelectedMarker(marker)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedMarker(marker);
                  }
                }}
              >
                <circle r="13" fill="#0a1a2f" fillOpacity="0.34" />
                <circle r="8" fill="#fff" stroke="#f0641a" strokeWidth="4" filter="url(#markerShadow)" />
              </g>
            ))}
          </g>
        ) : null}

        {measureActive ? (
          <g className="measurement-line">
            <path d="M205 532 461 489" stroke="#fff" strokeWidth="3" strokeDasharray="7 6" />
            <circle cx="205" cy="532" r="6" fill="#fff" />
            <circle cx="461" cy="489" r="6" fill="#fff" />
            <g transform="translate(294 487)">
              <rect width="92" height="38" rx="10" fill="#071426" fillOpacity="0.94" />
              <text x="46" y="24" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700">
                742 m
              </text>
            </g>
          </g>
        ) : null}
      </svg>

      {selectedMarker ? (
        <div className="marker-popover" role="status">
          <button
            type="button"
            className="marker-popover__close"
            aria-label="Fermer le détail de l’observation"
            onClick={() => setSelectedMarker(null)}
          >
            <Icon name="close" size={14} />
          </button>
          <div className="marker-popover__icon">
            <Icon name="location" size={18} />
          </div>
          <div>
            <strong>{selectedMarker.label}</strong>
            <span>{selectedMarker.detail}</span>
          </div>
        </div>
      ) : null}

      <div className="terrain-scale" aria-label="Échelle graphique de 500 mètres">
        <span>500 m</span>
        <i />
      </div>

      <div className="terrain-legend" aria-label="Légende">
        <strong>Légende</strong>
        <div>
          <span><i className="legend-swatch legend-swatch--zone" />zone estimée</span>
          <span><i className="legend-swatch legend-swatch--observation" />observation</span>
          <span><i className="legend-swatch legend-swatch--uncertainty" />incertitude</span>
        </div>
      </div>

      <div className="terrain-watermark" aria-hidden="true">
        {incident.fireId} · v{activeVersion} · {activeHash.slice(0, 8)}
      </div>

      {viewerState === 'MODEL_LOADING' || updateProgress !== null ? (
        <div className="model-loading" role="status" aria-live="polite">
          <div className="model-loading__surface">
            <span className="model-loading__icon">
              <Icon name="layers" size={24} />
            </span>
            <div>
              <strong>{updateProgress !== null ? 'Validation du modèle v5' : 'Chargement du terrain 3D'}</strong>
              <span>
                {updateProgress !== null
                  ? 'L’ancienne version reste affichée jusqu’au contrôle final.'
                  : 'Les métadonnées et la vue texte sont déjà disponibles.'}
              </span>
            </div>
            <div className="model-loading__bar" aria-hidden="true">
              <i style={{ width: `${updateProgress ?? 56}%` }} />
            </div>
            <span className="model-loading__percent">{updateProgress ?? 56} %</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
