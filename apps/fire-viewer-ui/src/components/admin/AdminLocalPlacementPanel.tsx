import type { PointerEvent } from 'react';

interface AdminLocalPlacementPanelProps {
  readonly bounds: readonly [number, number, number, number];
  readonly position: readonly [number, number] | null;
  readonly onChange: (position: readonly [number, number]) => void;
  readonly disabled?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function inBounds(position: readonly [number, number], bounds: readonly [number, number, number, number]): boolean {
  return position[0] >= bounds[0] && position[0] <= bounds[2] && position[1] >= bounds[1] && position[1] <= bounds[3];
}

export function AdminLocalPlacementPanel({ bounds, position, onChange, disabled = false }: AdminLocalPlacementPanelProps) {
  const [minX, minY, maxX, maxY] = bounds;
  const width = maxX - minX;
  const height = maxY - minY;
  const visiblePosition = position && inBounds(position, bounds) ? position : null;
  const markerX = visiblePosition ? ((visiblePosition[0] - minX) / width) * 100 : null;
  const markerY = visiblePosition ? ((maxY - visiblePosition[1]) / height) * 100 : null;

  const place = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const localX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const localY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    onChange([
      Math.round((minX + localX * width) * 100) / 100,
      Math.round((maxY - localY * height) * 100) / 100,
    ]);
  };

  return (
    <section className="admin-placement" aria-labelledby="admin-placement-title">
      <div className="admin-placement__heading">
        <div>
          <h3 id="admin-placement-title">Repère local de la zone</h3>
          <p>Cliquez dans l’emprise pour placer l’information. Ce schéma ne charge ni carte ni géométrie 3D.</p>
        </div>
        <span>{visiblePosition ? `${visiblePosition[0].toLocaleString('fr-FR')} / ${visiblePosition[1].toLocaleString('fr-FR')}` : 'Aucun point'}</span>
      </div>
      <svg
        className={`admin-placement__canvas ${disabled ? 'is-disabled' : ''}`}
        viewBox="0 0 100 100"
        role="img"
        aria-label="Emprise locale de la zone ; cliquez pour choisir une position Lambert-93"
        onPointerDown={place}
      >
        <defs>
          <pattern id="admin-local-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.35" />
          </pattern>
        </defs>
        <rect x="1" y="1" width="98" height="98" rx="3" fill="url(#admin-local-grid)" />
        <rect x="1" y="1" width="98" height="98" rx="3" fill="none" stroke="currentColor" strokeWidth="0.8" />
        <path d="M50 1V99M1 50H99" stroke="currentColor" strokeWidth="0.45" strokeDasharray="2 2" />
        {markerX !== null && markerY !== null ? (
          <g transform={`translate(${markerX} ${markerY})`}>
            <circle r="4.5" fill="currentColor" fillOpacity="0.2" />
            <circle r="2.2" fill="currentColor" />
          </g>
        ) : null}
      </svg>
      <div className="admin-placement__bounds" aria-hidden="true">
        <span>Y max {maxY.toLocaleString('fr-FR')}</span>
        <span>X min {minX.toLocaleString('fr-FR')}</span>
        <span>X max {maxX.toLocaleString('fr-FR')}</span>
        <span>Y min {minY.toLocaleString('fr-FR')}</span>
      </div>
    </section>
  );
}
