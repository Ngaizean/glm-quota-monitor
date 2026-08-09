import { Toggle as AccessibleToggle } from "../components/ui/Toggle";

interface LegacyToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * Compatibility wrapper for existing settings panes.
 * New code should import Toggle from components/ui/Toggle and provide a
 * contextual accessible name.
 */
export default function Toggle({
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: LegacyToggleProps) {
  const resolvedLabel = ariaLabel
    ?? (document.documentElement.lang.startsWith("en") ? "Toggle setting" : "切换设置");
  return (
    <AccessibleToggle
      checked={checked}
      disabled={disabled}
      aria-label={resolvedLabel}
      onCheckedChange={onChange}
    />
  );
}

export { AccessibleToggle as Toggle };
