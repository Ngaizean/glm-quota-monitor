import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ButtonSize, ButtonVariant } from "./Button";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  "aria-label": string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

export function IconButton({
  variant = "ghost",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: IconButtonProps) {
  const classes = ["ui-icon-button", `ui-icon-button--${variant}`, `ui-icon-button--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : children}
    </button>
  );
}
