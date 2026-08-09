import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback } from "react";
import { describe, expect, it } from "vitest";
import { useAsyncResource } from "./useAsyncResource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("useAsyncResource", () => {
  it("不会让旧请求覆盖新请求", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(
      ({ id }) => {
        const load = useCallback(() => id === 1 ? first.promise : second.promise, [id]);
        return useAsyncResource(load, [id]);
      },
      { initialProps: { id: 1 } },
    );

    rerender({ id: 2 });
    await act(async () => second.resolve("new"));
    await waitFor(() => expect(result.current.data).toBe("new"));

    await act(async () => first.resolve("old"));
    expect(result.current.data).toBe("new");
  });

  it("公开错误并允许重试", async () => {
    let attempts = 0;
    const { result } = renderHook(() => useAsyncResource(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return "ok";
    }, []));

    await waitFor(() => expect(result.current.error?.message).toBe("offline"));
    await act(async () => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe("ok"));
  });
});
