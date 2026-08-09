import type { ReactNode } from "react";
import { getAvatarGradient } from "../../lib/ui";
import type { Account } from "../../types";
import { StatusNotice } from "../../components/ui/StatusNotice";

interface AccountRowProps {
  account: Account;
  subtitle?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  error?: string;
}

export function AccountRow({ account, subtitle, metadata, actions, children, error }: AccountRowProps) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] overflow-hidden">
      <div className="flex items-center gap-3 p-3.5">
        <div
          className={`h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br ${getAvatarGradient(account.alias)} flex items-center justify-center text-[11px] font-bold text-white`}
          aria-hidden="true"
        >
          {account.alias.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{account.alias}</span>
            {metadata}
          </div>
          {subtitle && <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
      {error && (
        <div className="px-3.5 pb-3.5">
          <StatusNotice tone="danger">{error}</StatusNotice>
        </div>
      )}
    </div>
  );
}
