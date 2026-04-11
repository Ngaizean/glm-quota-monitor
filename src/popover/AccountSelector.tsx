import { getAvatarGradient, getLevelStyle } from "../lib/ui";

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
    <div className="px-4 py-3 animate-fade-in">
      <div className="flex items-center gap-2.5">
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${getAvatarGradient(current.alias)} flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-sm`}>
          {current.alias.charAt(0).toUpperCase()}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
            {current.alias}
          </span>
          {quota && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 ${getLevelStyle(quota.level)}`}>
              {quota.level}
            </span>
          )}
        </div>
      </div>
      {current.purpose && (
        <div className="mt-1.5 pl-[38px]">
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{current.purpose}</span>
        </div>
      )}
      {accounts.length > 1 && (
        <div className="flex gap-0.5 mt-2.5 bg-[var(--color-bg-tertiary)] rounded-lg p-0.5">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => onSelect(acc.id)}
              className={`flex-1 px-2 py-1.5 rounded-md text-[10px] font-medium transition-all duration-200 ${
                selected === acc.id
                  ? "bg-white text-[var(--color-text-primary)] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
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
