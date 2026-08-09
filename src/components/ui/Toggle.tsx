import type { ButtonHTMLAttributes } from "react";

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function Toggle({ checked, onCheckedChange, disabled, className, type = "button", ...props }: ToggleProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      className={["ui-toggle", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span className="ui-toggle__thumb" aria-hidden="true" />
    </button>
  );
}
