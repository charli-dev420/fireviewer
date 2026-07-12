interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'switch--checked' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="switch__thumb" />
    </button>
  );
}
