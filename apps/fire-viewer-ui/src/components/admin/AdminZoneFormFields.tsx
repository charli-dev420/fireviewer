export interface AdminZoneFormValue {
  readonly zoneId: string;
  readonly label: string;
  readonly description: string;
  readonly minX: string;
  readonly minY: string;
  readonly maxX: string;
  readonly maxY: string;
  readonly reason: string;
}

export function emptyAdminZoneForm(): AdminZoneFormValue {
  return {
    zoneId: '',
    label: '',
    description: '',
    minX: '',
    minY: '',
    maxX: '',
    maxY: '',
    reason: '',
  };
}

export function parseAdminZoneForm(value: AdminZoneFormValue): {
  zone_id: string;
  label: string;
  description: string;
  bounds_l93_m: readonly [number, number, number, number];
  reason: string;
} | null {
  const bounds = [value.minX, value.minY, value.maxX, value.maxY].map((item) => Number(item));
  if (
    !/^[A-Z][A-Z0-9-]{2,63}$/.test(value.zoneId)
    || value.label.trim().length === 0
    || value.description.trim().length === 0
    || value.reason.trim().length === 0
    || bounds.some((item) => !Number.isFinite(item))
    || bounds[0]! >= bounds[2]!
    || bounds[1]! >= bounds[3]!
  ) {
    return null;
  }
  return {
    zone_id: value.zoneId,
    label: value.label.trim(),
    description: value.description.trim(),
    bounds_l93_m: [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!],
    reason: value.reason.trim(),
  };
}

export function AdminZoneFormFields({
  value,
  onChange,
  includeZoneId,
  idPrefix,
  disabled = false,
}: {
  readonly value: AdminZoneFormValue;
  readonly onChange: (next: AdminZoneFormValue) => void;
  readonly includeZoneId: boolean;
  readonly idPrefix: string;
  readonly disabled?: boolean;
}) {
  const set = (key: keyof AdminZoneFormValue, next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="admin-form-grid">
      {includeZoneId ? (
        <label className="admin-field" htmlFor={`${idPrefix}-zone-id`}>
          <span>Identifiant stable</span>
          <input
            id={`${idPrefix}-zone-id`}
            aria-label="Identifiant stable"
            value={value.zoneId}
            onChange={(event) => set('zoneId', event.currentTarget.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            pattern={'[A-Z][A-Z0-9\\-]{2,63}'}
            placeholder="DIE-PONTAIX-08"
            required
            disabled={disabled}
          />
          <small>Majuscules, chiffres et tirets. Cet identifiant ne change pas.</small>
        </label>
      ) : null}
      <label className="admin-field" htmlFor={`${idPrefix}-label`}>
        <span>Nom public</span>
        <input
          id={`${idPrefix}-label`}
          aria-label="Nom public"
          value={value.label}
          onChange={(event) => set('label', event.currentTarget.value)}
          maxLength={255}
          required
          disabled={disabled}
        />
      </label>
      <label className="admin-field admin-field--wide" htmlFor={`${idPrefix}-description`}>
        <span>Description</span>
        <textarea
          id={`${idPrefix}-description`}
          aria-label="Description"
          value={value.description}
          onChange={(event) => set('description', event.currentTarget.value)}
          maxLength={4_000}
          rows={4}
          required
          disabled={disabled}
        />
      </label>
      <fieldset className="admin-fieldset admin-fieldset--wide">
        <legend>Emprise locale Lambert-93 (mètres)</legend>
        <div className="admin-coordinate-grid">
          <label htmlFor={`${idPrefix}-min-x`}><span>X minimum</span><input id={`${idPrefix}-min-x`} aria-label="X minimum" type="number" step="any" value={value.minX} onChange={(event) => set('minX', event.currentTarget.value)} required disabled={disabled} /></label>
          <label htmlFor={`${idPrefix}-min-y`}><span>Y minimum</span><input id={`${idPrefix}-min-y`} aria-label="Y minimum" type="number" step="any" value={value.minY} onChange={(event) => set('minY', event.currentTarget.value)} required disabled={disabled} /></label>
          <label htmlFor={`${idPrefix}-max-x`}><span>X maximum</span><input id={`${idPrefix}-max-x`} aria-label="X maximum" type="number" step="any" value={value.maxX} onChange={(event) => set('maxX', event.currentTarget.value)} required disabled={disabled} /></label>
          <label htmlFor={`${idPrefix}-max-y`}><span>Y maximum</span><input id={`${idPrefix}-max-y`} aria-label="Y maximum" type="number" step="any" value={value.maxY} onChange={(event) => set('maxY', event.currentTarget.value)} required disabled={disabled} /></label>
        </div>
        <small>Les données positionnées restent obligatoirement à l’intérieur de cette emprise locale.</small>
      </fieldset>
      <label className="admin-field admin-field--wide" htmlFor={`${idPrefix}-reason`}>
        <span>Motif administratif</span>
        <textarea
          id={`${idPrefix}-reason`}
          aria-label="Motif administratif"
          value={value.reason}
          onChange={(event) => set('reason', event.currentTarget.value)}
          maxLength={500}
          rows={2}
          required
          disabled={disabled}
        />
      </label>
    </div>
  );
}
