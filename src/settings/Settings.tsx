import { lazy, Suspense, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftIcon,
  BellIcon,
  ClockIcon,
  CodeIcon,
  DownloadIcon,
  InfoIcon,
  PaletteIcon,
  SettingsIcon,
  UserIcon,
} from "../components/icons";
import PageHeader from "./components/PageHeader";
import { version as APP_VERSION } from "../../package.json";

const AccountsPane = lazy(() => import("./AccountsPane"));
const AlertsPane = lazy(() => import("./AlertsPane"));
const SpinPane = lazy(() => import("./SpinPane"));
const CodexPane = lazy(() => import("./CodexPane"));
const GeneralPane = lazy(() => import("./GeneralPane"));
const ThemePane = lazy(() => import("./ThemePane"));
const ExportPane = lazy(() => import("./ExportPane"));
const AboutPane = lazy(() => import("./AboutPane"));

type NavId =
  | "accounts"
  | "alerts"
  | "spin"
  | "codex"
  | "general"
  | "theme"
  | "export"
  | "about";

interface NavItem {
  id: NavId;
  labelKey: string;
  titleKey: string;
  descriptionKey: string;
  icon: ReactNode;
  component: ComponentType;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "settings.groupManage",
    items: [
      {
        id: "accounts",
        labelKey: "settings.accountsLabel",
        titleKey: "settings.accounts",
        descriptionKey: "settings.accountsDesc",
        component: AccountsPane,
        icon: <UserIcon size={17} />,
      },
      {
        id: "alerts",
        labelKey: "settings.alertsLabel",
        titleKey: "settings.alerts",
        descriptionKey: "settings.alertsDesc",
        component: AlertsPane,
        icon: <BellIcon size={17} />,
      },
    ],
  },
  {
    labelKey: "settings.groupFeatures",
    items: [
      {
        id: "spin",
        labelKey: "settings.spinLabel",
        titleKey: "settings.spin",
        descriptionKey: "settings.spinDesc",
        component: SpinPane,
        icon: <ClockIcon size={17} />,
      },
      {
        id: "codex",
        labelKey: "settings.codexLabel",
        titleKey: "settings.codex",
        descriptionKey: "settings.codexDesc",
        component: CodexPane,
        icon: <CodeIcon size={17} />,
      },
    ],
  },
  {
    labelKey: "settings.groupGeneral",
    items: [
      {
        id: "general",
        labelKey: "settings.generalLabel",
        titleKey: "settings.general",
        descriptionKey: "settings.generalDesc",
        component: GeneralPane,
        icon: <SettingsIcon size={17} />,
      },
      {
        id: "theme",
        labelKey: "settings.themeLabel",
        titleKey: "settings.theme",
        descriptionKey: "settings.themeDesc",
        component: ThemePane,
        icon: <PaletteIcon size={17} />,
      },
      {
        id: "export",
        labelKey: "settings.exportLabel",
        titleKey: "settings.export",
        descriptionKey: "settings.exportDesc",
        component: ExportPane,
        icon: <DownloadIcon size={17} />,
      },
      {
        id: "about",
        labelKey: "settings.aboutLabel",
        titleKey: "settings.about",
        descriptionKey: "settings.aboutDesc",
        component: AboutPane,
        icon: <InfoIcon size={17} />,
      },
    ],
  },
];

function PaneFallback() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-24 rounded-2xl skeleton" />
      <div className="h-40 rounded-2xl skeleton" />
    </div>
  );
}

function getInitialNavId(): NavId {
  if (!import.meta.env.DEV || typeof window === "undefined") return "accounts";
  const candidate = new URLSearchParams(window.location.search).get("pane");
  const item = NAV_GROUPS.flatMap((group) => group.items).find(({ id }) => id === candidate);
  return item?.id ?? "accounts";
}

export default function Settings({ onBack, screenHeight }: { onBack: () => void; screenHeight: number }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<NavId>(getInitialNavId);
  const items = useMemo(() => NAV_GROUPS.flatMap((group) => group.items), []);
  const activeItem = items.find((item) => item.id === activeTab) ?? items[0];
  const ActivePane = activeItem.component;

  return (
    <div
      className="flex w-[760px] max-w-full select-none overflow-hidden rounded-2xl bg-[var(--color-bg-primary)] shadow-[var(--shadow-popover)]"
      style={{ height: Math.min(screenHeight, 720), maxHeight: screenHeight }}
    >
      <aside className="flex w-[168px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeftIcon size={16} />
          {t("settings.back")}
        </button>

        <nav className="scroll-area flex-1 space-y-5" aria-label={t("settings.navigation")}>
          {NAV_GROUPS.map((group) => (
            <div key={group.labelKey}>
              <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
                {t(group.labelKey)}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-xs font-medium transition-colors ${
                        active
                          ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                      }`}
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span>{t(item.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--color-border-subtle)] px-2 pt-3 text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
          Quota Monitor · v{APP_VERSION}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          title={t(activeItem.titleKey)}
          description={t(activeItem.descriptionKey)}
        />
        <div className="scroll-area flex-1 overscroll-contain px-7 py-6">
          <div key={activeTab} className="animate-fade-in">
            <Suspense fallback={<PaneFallback />}>
              <ActivePane />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
