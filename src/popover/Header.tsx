interface HeaderProps {
  loading: boolean;
  onRefresh: () => void;
  onSettings: () => void;
}

export default function Header({ loading, onRefresh, onSettings }: HeaderProps) {
  return (
    <div className="sticky top-0 z-10 backdrop-blur-2xl bg-[var(--color-bg-glass)] border-b border-[var(--color-border-subtle)]">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-violet-500 flex items-center justify-center shadow-sm">
            <span className="text-white text-[9px] font-bold tracking-tight">G</span>
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-[var(--color-text-primary)]">
            GLM Quota
          </span>
          {loading && (
            <div className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "75ms" }} />
              <span className="w-1 h-1 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "150ms" }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-[var(--transition-fast)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] disabled:opacity-40"
            title="刷新"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            onClick={onSettings}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-[var(--transition-fast)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            title="设置"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
