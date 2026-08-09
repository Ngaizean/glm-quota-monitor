import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export type AsyncResourceStatus = "idle" | "loading" | "success" | "error";

export interface UseAsyncResourceOptions<T> {
  enabled?: boolean;
  initialData?: T | null;
  clearOnLoad?: boolean;
}

export interface AsyncResource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  status: AsyncResourceStatus;
  reload: () => Promise<T | undefined>;
  reset: () => void;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * 管理可重试异步资源。调用方通过 dependencies 明确请求身份；晚到的旧请求和卸载后的
 * 请求都不会提交状态。loader 保存在 ref 中，因此内联函数不会导致额外请求。
 */
export function useAsyncResource<T>(
  loader: () => Promise<T>,
  dependencies: DependencyList,
  options: UseAsyncResourceOptions<T> = {},
): AsyncResource<T> {
  const { enabled = true, initialData = null, clearOnLoad = false } = options;
  const loaderRef = useRef(loader);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<AsyncResourceStatus>(enabled ? "loading" : "idle");

  loaderRef.current = loader;

  const reload = useCallback(async () => {
    if (!mountedRef.current) return undefined;
    const requestId = ++requestIdRef.current;
    setStatus("loading");
    setError(null);
    if (clearOnLoad) setData(null);

    try {
      const value = await loaderRef.current();
      if (!mountedRef.current || requestId !== requestIdRef.current) return undefined;
      setData(value);
      setStatus("success");
      return value;
    } catch (reason) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return undefined;
      setError(toError(reason));
      setStatus("error");
      return undefined;
    }
  }, [clearOnLoad]);

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    requestIdRef.current += 1;
    setData(initialData);
    setError(null);
    setStatus("idle");
  }, [initialData]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      void reload();
    } else {
      requestIdRef.current += 1;
      setStatus("idle");
    }

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
    // dependencies 是该资源的显式身份，loader 通过 ref 始终读取最新版。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reload, ...dependencies]);

  return {
    data,
    error,
    loading: status === "loading",
    status,
    reload,
    reset,
  };
}
