export type DisplayLocale = "zh-CN" | "en-US";

export function resolveDisplayLocale(language?: string): DisplayLocale {
  return language?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatClockTime(
  value: string | number | Date,
  locale: DisplayLocale = "zh-CN",
): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatChartTime(
  value: string | number | Date,
  rangeDays: number,
  locale: DisplayLocale = "zh-CN",
): string {
  const date = toDate(value);
  if (!date) return "";
  const options: Intl.DateTimeFormatOptions = rangeDays > 1
    ? { month: "2-digit", day: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export interface RelativeTimeOptions {
  now?: number;
  locale?: DisplayLocale;
}

export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  options: RelativeTimeOptions = {},
): string {
  if (value == null) return "—";
  const date = toDate(value);
  if (!date) return "—";

  const now = options.now ?? Date.now();
  const locale = options.locale ?? "zh-CN";
  const seconds = (date.getTime() - now) / 1000;
  const absoluteSeconds = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (absoluteSeconds < 60) return formatter.format(Math.round(seconds), "second");
  if (absoluteSeconds < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absoluteSeconds < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (absoluteSeconds < 7 * 86400) return formatter.format(Math.round(seconds / 86400), "day");

  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatCompactNumber(value: number, locale: DisplayLocale = "zh-CN"): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatTokens(value: number, locale: DisplayLocale = "zh-CN"): string {
  return formatCompactNumber(Math.max(Number.isFinite(value) ? value : 0, 0), locale);
}

export function formatCurrency(
  value: number,
  currency: string,
  locale: DisplayLocale = "zh-CN",
): string {
  const normalizedCurrency = currency.trim().toUpperCase() || "CNY";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${normalizedCurrency} ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  }
}

export function sanitizeFilenameSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "");
  return sanitized || "export";
}
