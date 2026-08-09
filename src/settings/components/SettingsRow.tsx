import type { ReactNode } from "react";

interface SettingsRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  htmlFor?: string;
  stacked?: boolean;
}

export default function SettingsRow({
  label,
  description,
  children,
  htmlFor,
  stacked = false,
}: SettingsRowProps) {
  const labelContent = (
    <>
      <span className="block text-[13px] font-medium text-[var(--color-text-primary)]">
        {label}
      </span>
      {description && (
        <span className="mt-1 block text-[11px] leading-5 text-[var(--color-text-tertiary)]">
          {description}
        </span>
      )}
    </>
  );

  return (
    <div
      className={`gap-5 px-5 py-4 ${
        stacked ? "space-y-3" : "flex items-center justify-between"
      }`}
    >
      <div className={stacked ? undefined : "min-w-0 flex-1"}>
        {htmlFor ? <label htmlFor={htmlFor}>{labelContent}</label> : labelContent}
      </div>
      <div className={stacked ? undefined : "shrink-0"}>{children}</div>
    </div>
  );
}
