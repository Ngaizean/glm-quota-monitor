import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePopoverWindowLifecycle } from "./usePopoverWindowLifecycle";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: mocks.getCurrentWindow }));

describe("usePopoverWindowLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00Z"));
    mocks.invoke.mockReset().mockResolvedValue(undefined);
    mocks.getCurrentWindow.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("listener promise 在卸载后才返回时立即解绑且回调失效", async () => {
    const moved = deferred<() => void>();
    const focused = deferred<() => void>();
    const unlistenMoved = vi.fn();
    const unlistenFocused = vi.fn();
    const onFocus = vi.fn();
    let focusHandler!: (event: { payload: boolean }) => void;
    mocks.getCurrentWindow.mockReturnValue({
      onMoved: vi.fn(() => moved.promise),
      onFocusChanged: vi.fn((handler: typeof focusHandler) => {
        focusHandler = handler;
        return focused.promise;
      }),
    });

    const { unmount } = renderHook(() => usePopoverWindowLifecycle({ onFocus }));
    unmount();
    focusHandler({ payload: true });
    await act(async () => {
      moved.resolve(unlistenMoved);
      focused.resolve(unlistenFocused);
      await Promise.resolve();
    });

    expect(onFocus).not.toHaveBeenCalled();
    expect(unlistenMoved).toHaveBeenCalledOnce();
    expect(unlistenFocused).toHaveBeenCalledOnce();
  });

  it("卸载会清理待执行的关闭 timer", async () => {
    const handlers = installImmediateWindowListeners();
    const { unmount } = renderHook(() => usePopoverWindowLifecycle({ showGraceMs: 0, closeDelayMs: 100 }));
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(0));
    act(() => handlers.focus({ payload: false }));
    unmount();
    act(() => vi.advanceTimersByTime(100));

    expect(mocks.invoke).not.toHaveBeenCalledWith("close_popover");
  });

  it("窗口拖动导致的失焦不会关闭 popover", async () => {
    const handlers = installImmediateWindowListeners();
    renderHook(() => usePopoverWindowLifecycle({ showGraceMs: 0, closeDelayMs: 100, dragGraceMs: 400 }));
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(0));
    act(() => {
      handlers.moved();
      handlers.focus({ payload: false });
      vi.advanceTimersByTime(100);
    });

    expect(mocks.invoke).not.toHaveBeenCalledWith("close_popover");
  });

  function installImmediateWindowListeners() {
    let moved!: () => void;
    let focus!: (event: { payload: boolean }) => void;
    mocks.getCurrentWindow.mockReturnValue({
      onMoved: vi.fn((handler: typeof moved) => {
        moved = handler;
        return Promise.resolve(vi.fn());
      }),
      onFocusChanged: vi.fn((handler: typeof focus) => {
        focus = handler;
        return Promise.resolve(vi.fn());
      }),
    });
    return {
      get moved() { return moved; },
      get focus() { return focus; },
    };
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
