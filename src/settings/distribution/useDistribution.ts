import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_DISTRIBUTION, type DistributionState } from "./types";

export function useDistribution() {
  const [data, setData] = useState<DistributionState>(EMPTY_DISTRIBUTION);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await invoke<DistributionState>("get_distribution_state");
      if (mounted.current && current === generation.current) {
        setData(next);
        setError("");
      }
    } catch (error) {
      if (mounted.current && current === generation.current)
        setError(String(error));
    } finally {
      if (mounted.current && current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const subscription = listen("accounts-changed", () => {
      void refresh();
    });
    const timer = window.setInterval(() => {
      if (!pending.current) void refresh();
    }, 15000);
    return () => {
      mounted.current = false;
      generation.current++;
      window.clearInterval(timer);
      void subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [refresh]);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      if (pending.current) return false;
      pending.current = true;
      setBusy(true);
      setError("");
      try {
        await action();
        await refresh();
        return true;
      } catch (error) {
        if (mounted.current) setError(String(error));
        return false;
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [refresh],
  );
  return { data, loading, busy, error, refresh, run };
}
