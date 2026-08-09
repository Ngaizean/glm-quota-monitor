import type { ReactNode } from "react";

interface SettingsSectionProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function SettingsSection({
  title,
  description,
  action,
  children,
  className = "",
}: SettingsSectionProps) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] shadow-sm ${className}`}
    >
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-tertiary)]">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="divide-y divide-[var(--color-border-subtle)]">{children}</div>
    </section>
  );
}
