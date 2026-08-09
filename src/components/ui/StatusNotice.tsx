import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangleIcon, CheckIcon, InfoIcon } from "../icons";

export type NoticeTone = "info" | "success" | "warning" | "danger";

export interface StatusNoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: NoticeTone;
  title?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}

function defaultIcon(tone: NoticeTone) {
  if (tone === "success") return <CheckIcon size={15} />;
  if (tone === "warning" || tone === "danger") return <AlertTriangleIcon size={15} />;
  return <InfoIcon size={15} />;
}

export function StatusNotice({ tone = "info", title, icon, children, className, ...props }: StatusNoticeProps) {
  return (
    <div
      className={["ui-notice", `ui-notice--${tone}`, className].filter(Boolean).join(" ")}
      role={tone === "danger" ? "alert" : "status"}
      {...props}
    >
      <span className="ui-notice__icon">{icon ?? defaultIcon(tone)}</span>
      <div className="ui-notice__content">
        {title && <div className="ui-notice__title">{title}</div>}
        {children && <div className="ui-notice__description">{children}</div>}
      </div>
    </div>
  );
}
