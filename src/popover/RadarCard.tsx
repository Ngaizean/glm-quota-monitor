import { useTranslation } from "react-i18next";
import type { CodexRadarData } from "./useDashboardData";

function probabilityTone(value: number): "positive" | "warning" | "info" | "neutral" {
  if (value >= 0.5) return "positive";
  if (value >= 0.3) return "warning";
  if (value >= 0.15) return "info";
  return "neutral";
}

function formatUpdatedAt(iso: string, language: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const locale = language.startsWith("en") ? "en-US" : "zh-CN";
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (seconds < 60) return relative.format(-seconds, "second");
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return relative.format(-Math.floor(seconds / 3600), "hour");
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

interface RadarCardProps {
  data: CodexRadarData;
  refreshing: boolean;
  error?: string;
  onRefresh: () => void;
}

export default function RadarCard({ data, refreshing, error, onRefresh }: RadarCardProps) {
  const { t, i18n } = useTranslation();
  const probability = Math.min(1, Math.max(0, data.probability_24h));
  const tone = probabilityTone(probability);

  return (
    <section className="radar-card" aria-labelledby="radar-title">
      <div className="radar-card__header">
        <div>
          <p className="eyebrow" id="radar-title">{t("radar.title")}</p>
          <p className="radar-card__model" title={data.best_model}>{data.best_model}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={t("radar.refresh")}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? "animate-spin" : ""}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>
      <div className="radar-card__metrics">
        <div className="radar-metric">
          <span className="radar-metric__label">{t("radar.iq")}</span>
          <strong className="radar-metric__value">{data.best_score.toFixed(1)}</strong>
        </div>
        <div className="radar-metric" data-tone={tone}>
          <span className="radar-metric__label">{t("radar.reset24h")}</span>
          <strong className="radar-metric__value">{Math.round(probability * 100)}%</strong>
        </div>
      </div>
      {(data.daily_models.length > 0 || data.hard_problem_models.length > 0) && (
        <div className="radar-card__recommendations">
          {data.daily_models.length > 0 && (
            <div className="radar-recommendation">
              <span>{t("radar.dailyDevelopment")}</span>
              <strong title={data.daily_models.join(" · ")}>{data.daily_models.join(" · ")}</strong>
            </div>
          )}
          {data.hard_problem_models.length > 0 && (
            <div className="radar-recommendation">
              <span>{t("radar.hardProblems")}</span>
              <strong title={data.hard_problem_models.join(" · ")}>{data.hard_problem_models.join(" · ")}</strong>
            </div>
          )}
        </div>
      )}
      <div className="radar-card__footer">
        <span>{t("radar.source")}</span>
        <span>{formatUpdatedAt(data.updated_at, i18n.language)}</span>
      </div>
      {error && <p className="status-inline status-inline--critical" role="status">{error}</p>}
    </section>
  );
}
