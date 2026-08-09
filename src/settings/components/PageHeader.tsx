import { invoke } from "@tauri-apps/api/core";
import type { MouseEvent } from "react";

interface PageHeaderProps {
  title: string;
  description: string;
}

export default function PageHeader({ title, description }: PageHeaderProps) {
  function handleDrag(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea")) return;
    void invoke("start_window_drag").catch(() => {});
  }

  return (
    <header
      className="shrink-0 border-b border-[var(--color-border-subtle)] px-7 py-5 cursor-default"
      data-tauri-drag-region
      onMouseDown={handleDrag}
    >
      <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
        {title}
      </h1>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
        {description}
      </p>
    </header>
  );
}
