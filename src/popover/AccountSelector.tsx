interface Account {
  id: string;
  alias: string;
  purpose: string;
  level: string | null;
  is_active: boolean;
}

interface QuotaData {
  limits: { type: string; percentage: number; nextResetTime: number }[];
  level: string;
}

interface Props {
  accounts: Account[];
  selected: string;
  onSelect: (id: string) => void;
  quota: QuotaData | null;
}

export default function AccountSelector({ accounts, selected, onSelect, quota }: Props) {
  const current = accounts.find((a) => a.id === selected);
  if (!current) return null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-[var(--color-accent-subtle)] flex items-center justify-center text-[10px] font-semibold text-[var(--color-accent)] shrink-0">
          {current.alias.charAt(0).toUpperCase()}
        </div>
        <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
          {current.alias}
        </span>
        {quota && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent)] uppercase shrink-0">
            {quota.level}
          </span>
        )}
        {current.purpose && (
          <span className="text-[10px] text-[var(--color-text-tertiary)] truncate">
            {current.purpose}
          </span>
        )}
      </div>
      {accounts.length > 1 && (
        <div className="flex gap-0.5 mt-2 bg-[var(--color-bg-secondary)] rounded-lg p-0.5">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => onSelect(acc.id)}
              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-[var(--transition-fast)] ${
                selected === acc.id
                  ? "bg-white text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]"
                  : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              {acc.purpose || acc.alias}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
