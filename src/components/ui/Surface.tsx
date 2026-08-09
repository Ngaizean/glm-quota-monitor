import type { HTMLAttributes, ReactNode } from "react";

export type SurfaceTone = "primary" | "secondary" | "raised" | "plain";
export type SurfacePadding = "none" | "sm" | "md" | "lg";

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  tone?: SurfaceTone;
  padding?: SurfacePadding;
}

export function Surface({ tone = "primary", padding = "md", className, ...props }: SurfaceProps) {
  const classes = ["ui-surface", `ui-surface--${tone}`, `ui-surface--padding-${padding}`, className]
    .filter(Boolean)
    .join(" ");
  return <div className={classes} {...props} />;
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function Section({ title, description, action, children, className, ...props }: SectionProps) {
  const hasHeader = title || description || action;
  return (
    <section className={["ui-section", className].filter(Boolean).join(" ")} {...props}>
      {hasHeader && (
        <header className="ui-section__header">
          <div className="ui-section__heading">
            {title && <h2 className="ui-section__title">{title}</h2>}
            {description && <p className="ui-section__description">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="ui-section__content">{children}</div>
    </section>
  );
}
