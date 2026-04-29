import { useState } from "react";

const CURRENT_VERSION = "v4.4.0";

interface GithubRelease {
  tag_name: string;
  html_url: string;
}

export default function AboutPane() {
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");
  const [updateUrl, setUpdateUrl] = useState("");

  async function handleCheckUpdate() {
    setChecking(true);
    setUpdateMsg("");
    setUpdateUrl("");
    try {
      const resp = await fetch(
        "https://api.github.com/repos/Ngaizean/glm-quota-monitor/releases/latest"
      );
      const release: GithubRelease = await resp.json();
      const latest = release.tag_name;
      if (latest && latest !== CURRENT_VERSION) {
        setUpdateMsg(`发现新版本 ${latest}`);
        setUpdateUrl(release.html_url);
      } else {
        setUpdateMsg("已是最新版本");
      }
    } catch {
      setUpdateMsg("检查失败，请稍后重试");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-10 space-y-4">
      <div className="w-16 h-16 bg-gradient-to-br from-[var(--color-accent)] to-violet-500 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-[var(--color-accent)]/20">
        G
      </div>
      <div className="text-center space-y-1.5">
        <h2 className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]">
          GLM Quota Monitor
        </h2>
        <span className="inline-block text-[10px] font-medium text-[var(--color-text-tertiary)] bg-[var(--color-bg-secondary)] px-2 py-0.5 rounded-md border border-[var(--color-border-subtle)]">
          {CURRENT_VERSION}
        </span>
      </div>
      <p className="text-[11px] text-[var(--color-text-tertiary)] text-center leading-relaxed">
        智谱 GLM Coding Plan<br />额度监控工具
      </p>
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={handleCheckUpdate}
          disabled={checking}
          className="text-[11px] font-medium px-4 py-1.5 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] rounded-lg text-[var(--color-text-secondary)] transition-[var(--transition-fast)] disabled:opacity-40"
        >
          {checking ? "检查中..." : "检查更新"}
        </button>
        {updateMsg && !updateUrl && (
          <span className="text-[10px] text-[var(--color-text-tertiary)]">{updateMsg}</span>
        )}
        {updateUrl && (
          <a
            href={updateUrl}
            target="_blank"
            className="text-[10px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          >
            {updateMsg} →
          </a>
        )}
      </div>
      <a
        href="https://github.com/Ngaizean/glm-quota-monitor"
        target="_blank"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-[var(--transition-fast)] mt-1 px-3 py-1.5 rounded-lg hover:bg-[var(--color-accent-subtle)]"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
        GitHub
      </a>
    </div>
  );
}
