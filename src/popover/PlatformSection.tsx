import type { Account, QuotaData } from "../types";
import AccountList from "./AccountList";

interface PlatformSectionProps {
  title: string;
  accounts: Account[];
  expandedIds: Set<string>;
  quotas: Record<string, QuotaData>;
  loading: boolean;
  refreshKey: number;
  onToggle: (id: string) => void;
  onSetPrimary: (id: string) => void;
}

export default function PlatformSection({ title, accounts, ...accountListProps }: PlatformSectionProps) {
  if (accounts.length === 0) return null;

  return (
    <section className="provider-section" aria-labelledby={`provider-${accounts[0].platform ?? "zhipu"}`}>
      <div className="provider-section__header">
        <h2 id={`provider-${accounts[0].platform ?? "zhipu"}`}>{title}</h2>
        <span className="count-badge" aria-label={`${accounts.length}`}>{accounts.length}</span>
      </div>
      <AccountList accounts={accounts} {...accountListProps} />
    </section>
  );
}
