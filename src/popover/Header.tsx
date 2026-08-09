import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { CloseIcon, RefreshIcon, SettingsIcon } from "../components/icons";
import { IconButton } from "../components/ui/IconButton";

interface HeaderProps {
  loading: boolean;
  onRefresh: () => void;
  onSettings: () => void;
}

export default function Header({ loading, onRefresh, onSettings }: HeaderProps) {
  const { t } = useTranslation();

  function handleDrag(event: React.MouseEvent) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea")) return;
    void invoke("start_window_drag").catch((error) => {
      console.error("failed to start window drag", error);
    });
  }

  return (
    <header className="window-header" data-tauri-drag-region onMouseDown={handleDrag}>
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true"><span>Q</span></div>
        <div className="brand-copy">
          <strong>{t("header.title")}</strong>
          <span>{loading ? t("header.refreshing") : t("header.ready")}</span>
        </div>
      </div>
      <div className="window-actions">
        <IconButton aria-label={t("header.refresh")} onClick={onRefresh} loading={loading}>
          <RefreshIcon />
        </IconButton>
        <IconButton aria-label={t("header.settings")} onClick={onSettings}>
          <SettingsIcon />
        </IconButton>
        <IconButton
          aria-label={t("header.close")}
          onClick={() => void invoke("close_popover").catch((error) => console.error("failed to close popover", error))}
        >
          <CloseIcon />
        </IconButton>
      </div>
    </header>
  );
}
