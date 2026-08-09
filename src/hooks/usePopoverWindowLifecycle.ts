import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";

export interface PopoverWindowLifecycleOptions {
  enabled?: boolean;
  onFocus?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  closeOnBlur?: boolean;
  showGraceMs?: number;
  closeDelayMs?: number;
  dragGraceMs?: number;
}

/** 菜单栏窗口的刷新、失焦关闭和拖动保护；所有异步 listener 与 timer 均可安全卸载。 */
export function usePopoverWindowLifecycle(options: PopoverWindowLifecycleOptions = {}) {
  const callbackRef = useRef({ onFocus: options.onFocus, onError: options.onError });
  callbackRef.current = { onFocus: options.onFocus, onError: options.onError };

  const {
    enabled = true,
    closeOnBlur = true,
    showGraceMs = 300,
    closeDelayMs = 150,
    dragGraceMs = 400,
  } = options;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let canClose = false;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastMoveAt = 0;
    const unlisteners: Array<() => void> = [];
    const windowHandle = getCurrentWindow();

    const reportError = (error: unknown) => {
      if (active) callbackRef.current.onError?.(error);
    };
    const register = (promise: Promise<() => void>) => {
      void promise
        .then((unlisten) => {
          if (active) unlisteners.push(unlisten);
          else unlisten();
        })
        .catch(reportError);
    };
    const clearCloseTimer = () => {
      if (closeTimer != null) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };

    const showTimer = setTimeout(() => {
      canClose = true;
    }, showGraceMs);

    register(windowHandle.onMoved(() => {
      if (!active) return;
      lastMoveAt = Date.now();
    }));
    register(windowHandle.onFocusChanged(({ payload: focused }) => {
      if (!active) return;
      if (focused) {
        clearCloseTimer();
        try {
          const result = callbackRef.current.onFocus?.();
          if (result) void result.catch(reportError);
        } catch (error) {
          reportError(error);
        }
        return;
      }
      if (!closeOnBlur || !canClose) return;

      clearCloseTimer();
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (!active || Date.now() - lastMoveAt <= dragGraceMs) return;
        void invoke("close_popover").catch(reportError);
      }, closeDelayMs);
    }));

    return () => {
      active = false;
      clearTimeout(showTimer);
      clearCloseTimer();
      for (const unlisten of unlisteners) unlisten();
    };
  }, [closeDelayMs, closeOnBlur, dragGraceMs, enabled, showGraceMs]);
}
