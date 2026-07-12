import type { IncidentStatusCode } from '../types';
import { Icon } from './Icons';

interface StatusPillProps {
  code: IncidentStatusCode;
  label: string;
  compact?: boolean;
}

const toneByCode: Record<IncidentStatusCode, string> = {
  CANDIDATE: 'neutral',
  REVIEW: 'warning',
  ACTIVE_CONFIRMED: 'critical',
  MONITORING: 'warning',
  EXTINGUISHED: 'success',
  CLOSED: 'neutral',
  SUSPENDED: 'suspended',
};

export function StatusPill({ code, label, compact = false }: StatusPillProps) {
  const tone = toneByCode[code];
  return (
    <span className={`status-pill status-pill--${tone} ${compact ? 'status-pill--compact' : ''}`}>
      <span className="status-pill__icon" aria-hidden="true">
        {code === 'ACTIVE_CONFIRMED' || code === 'EXTINGUISHED' ? (
          <Icon name="check" size={14} />
        ) : code === 'SUSPENDED' ? (
          <Icon name="shield" size={14} />
        ) : (
          <Icon name="clock" size={14} />
        )}
      </span>
      {label}
    </span>
  );
}
