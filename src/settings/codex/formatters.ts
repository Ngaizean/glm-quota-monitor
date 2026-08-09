export type Translate = (key: string, options?: Record<string, unknown>) => string;

export function formatExpiry(iso: string | null, t: Translate): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const absolute = Math.abs(diff);
  const isPast = diff < 0;
  const days = Math.floor(absolute / 86_400_000);
  const hours = Math.floor((absolute % 86_400_000) / 3_600_000);
  const minutes = Math.floor((absolute % 3_600_000) / 60_000);

  if (days > 0) {
    return isPast
      ? t("codexPane.expiredDaysAgo", { count: days })
      : t("codexPane.expiresInDays", { count: days, hours });
  }
  if (hours > 0) {
    return isPast
      ? t("codexPane.expiredHoursAgo", { count: hours })
      : t("codexPane.expiresInHours", { hours, minutes });
  }
  return isPast
    ? t("codexPane.expiredMinsAgo", { count: Math.max(minutes, 1) })
    : t("codexPane.expiresInMins", { count: Math.max(minutes, 1) });
}

export function formatRelative(iso: string | null, t: Translate): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return t("account.justNow");
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return t("account.daysAgo", { count: days });
  if (hours > 0) return t("account.hoursAgo", { count: hours });
  if (minutes > 0) return t("account.minutesAgo", { count: minutes });
  return t("account.justNow");
}

