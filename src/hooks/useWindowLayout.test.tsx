import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowLayout } from "./useWindowLayout";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("useWindowLayout", () => {
  let height: number;
  let resizeCallback: ResizeObserverCallback | null;
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;
  let requestFrame: ReturnType<typeof vi.fn>;
  let element: HTMLDivElement;
  let ref: RefObject<HTMLElement | null>;

  beforeEach(() => {
    height = 100.2;
    resizeCallback = null;
    nextFrameId = 1;
    frames = new Map();
    invokeMock.mockReset().mockResolvedValue(undefined);
    requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => ({ height } as DOMRect));
    ref = { current: element };
  });

  afterEach(() => vi.unstubAllGlobals());

  function flushFrame() {
    const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) throw new Error("没有待执行的 animation frame");
    frames.delete(entry[0]);
    act(() => entry[1](performance.now()));
  }

  it("同一帧合并多次测量并传递 width 参数", () => {
    const { result } = renderHook(() => useWindowLayout(ref, { width: 420, maxHeight: 500 }));
    act(() => {
      result.current.measureNow();
      result.current.measureNow();
    });

    expect(requestFrame).toHaveBeenCalledTimes(1);
    flushFrame();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("fit_window_size", { height: 101, width: 420 });
  });

  it("跳过未变化尺寸，变化后才再次提交", () => {
    renderHook(() => useWindowLayout(ref, { width: 420, maxHeight: 500 }));
    flushFrame();

    act(() => resizeCallback?.([], {} as ResizeObserver));
    flushFrame();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    height = 120;
    act(() => resizeCallback?.([], {} as ResizeObserver));
    flushFrame();
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("fit_window_size", { height: 120, width: 420 });
  });

  it("invoke 失败后清除尺寸缓存，允许原尺寸重试", async () => {
    const onError = vi.fn();
    invokeMock.mockRejectedValueOnce(new Error("window unavailable"));
    const { result } = renderHook(() => useWindowLayout(ref, {
      width: 420,
      maxHeight: 500,
      onError,
    }));

    flushFrame();
    await act(async () => Promise.resolve());
    expect(onError).toHaveBeenCalledTimes(1);

    act(() => result.current.measureNow());
    flushFrame();
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("fit_window_size", { height: 101, width: 420 });
  });

  it("旧请求延迟失败时不清除新尺寸缓存", async () => {
    let rejectFirst: ((reason: unknown) => void) | undefined;
    invokeMock.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    }));
    const { result } = renderHook(() => useWindowLayout(ref, { width: 420, maxHeight: 500 }));

    flushFrame();
    height = 120;
    act(() => result.current.measureNow());
    flushFrame();
    expect(invokeMock).toHaveBeenCalledTimes(2);

    await act(async () => rejectFirst?.(new Error("stale failure")));
    act(() => result.current.measureNow());
    flushFrame();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
