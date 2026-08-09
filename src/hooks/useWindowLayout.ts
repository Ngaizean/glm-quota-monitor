import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, type RefObject } from "react";

export interface WindowLayoutOptions {
  width?: number;
  maxHeight?: number | (() => number);
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

function resolveMaximumHeight(value: WindowLayoutOptions["maxHeight"]): number {
  if (typeof value === "function") return value();
  if (typeof value === "number") return value;
  return typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.screen.availHeight;
}

/** 将内容尺寸同步给 Tauri 窗口；同一帧只提交一次，并跳过未变化的尺寸。 */
export function useWindowLayout(
  containerRef: RefObject<HTMLElement | null>,
  options: WindowLayoutOptions = {},
) {
  const { width, maxHeight, enabled = true } = options;
  const onErrorRef = useRef(options.onError);
  const frameRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ height: number; width?: number } | null>(null);
  onErrorRef.current = options.onError;

  const measureNow = useCallback(() => {
    const element = containerRef.current;
    if (!element || !enabled) return;

    const height = Math.max(1, Math.ceil(Math.min(element.getBoundingClientRect().height, resolveMaximumHeight(maxHeight))));
    const next = { height, ...(width == null ? {} : { width: Math.max(1, Math.ceil(width)) }) };
    const previous = lastSizeRef.current;
    if (previous?.height === next.height && previous.width === next.width) return;
    lastSizeRef.current = next;

    void invoke("fit_window_size", next).catch((error) => {
      // 只撤销这次失败的乐观缓存；避免旧请求的延迟失败覆盖新尺寸。
      if (lastSizeRef.current === next) lastSizeRef.current = null;
      onErrorRef.current?.(error);
    });
  }, [containerRef, enabled, maxHeight, width]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measureNow();
    });
  }, [measureNow]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !enabled) return;

    scheduleMeasure();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    observer?.observe(element);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [containerRef, enabled, scheduleMeasure]);

  return { measureNow: scheduleMeasure };
}
