import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncInfo } from "../codex/types";

export function useCloudSync() {
  const [role, setRole] = useState("owner");
  const [url, setUrl] = useState("");
  const [proxy, setProxy] = useState("");
  const [token, setToken] = useState("");
  const [upload, setUpload] = useState(false);
  const [download, setDownload] = useState(true);
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void Promise.all([
      invoke<string>("get_codex_role"),
      invoke<string | null>("get_codex_gist_url"),
      invoke<string | null>("get_codex_proxy"),
      invoke<boolean>("get_codex_auto_upload"),
      invoke<boolean>("get_codex_auto_sync"),
      invoke<SyncInfo>("get_codex_sync_info"),
    ])
      .then(([role, url, proxy, upload, download, info]) => {
        if (!mounted.current) return;
        setRole(role);
        setUrl(url ?? "");
        setProxy(proxy ?? "");
        setUpload(upload);
        setDownload(download);
        setInfo(info);
      })
      .catch((e) => {
        if (mounted.current) setError(String(e));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setSuccess(false);
    try {
      await action();
      if (mounted.current) {
        setInfo(await invoke<SyncInfo>("get_codex_sync_info"));
        setSuccess(true);
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  const save = async () => {
    await invoke("set_codex_gist_url", { url });
    await invoke("set_codex_proxy", { url: proxy });
    if (token) {
      await invoke("set_codex_github_token", { token });
      setToken("");
    }
  };
  return {
    role,
    url,
    proxy,
    token,
    upload,
    download,
    info,
    loading,
    busy,
    error,
    success,
    setUrl,
    setProxy,
    setToken,
    run,
    save: () => run(save),
    changeRole: (next: string) =>
      run(async () => {
        await invoke("set_codex_role", { role: next });
        setRole(next);
      }),
    toggleAuto: (enabled: boolean) =>
      run(async () => {
        await invoke(
          role === "owner" ? "set_codex_auto_upload" : "set_codex_auto_sync",
          { enabled },
        );
        if (role === "owner") setUpload(enabled);
        else setDownload(enabled);
      }),
    sync: () =>
      run(async () => {
        await save();
        await invoke(
          role === "owner" ? "upload_codex_auth" : "sync_codex_auth",
        );
      }),
    clearToken: () =>
      run(async () => {
        await invoke("set_codex_github_token", { token: "" });
        setToken("");
      }),
  };
}
