import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import GeneralPane from "./GeneralPane";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockLoadedSettings(options?: { rejectIntervalSave?: boolean }) {
  invokeMock.mockImplementation((command: string, args?: { key?: string; accountId?: string }) => {
    if (command === "get_setting" && args?.key === "refresh_interval") return Promise.resolve("5");
    if (command === "get_setting" && args?.key === "auto_start") return Promise.resolve("0");
    if (command === "get_default_model") return Promise.resolve("glm-current");
    if (command === "list_accounts") {
      return Promise.resolve([{
        id: "glm-a", alias: "Work", purpose: "test", platform: "zhipu",
        level: null, is_active: true, is_primary: true,
      }]);
    }
    if (command === "fetch_models" && args?.accountId === "glm-a") return Promise.resolve(["glm-next"]);
    if (command === "set_setting" && args?.key === "refresh_interval" && options?.rejectIntervalSave) {
      return Promise.reject(new Error("save failed"));
    }
    return Promise.resolve(undefined);
  });
}

describe("GeneralPane", () => {
  beforeEach(async () => {
    invokeMock.mockReset();
    await i18n.changeLanguage("zh");
  });

  it("初始设置尚未加载时不会把界面默认值写回后端", async () => {
    const interval = deferred<string | null>();
    const autoStart = deferred<string | null>();
    const model = deferred<string>();
    invokeMock.mockImplementation((command: string, args?: { key?: string }) => {
      if (command === "get_setting" && args?.key === "refresh_interval") return interval.promise;
      if (command === "get_setting" && args?.key === "auto_start") return autoStart.promise;
      if (command === "get_default_model") return model.promise;
      return Promise.resolve(undefined);
    });

    render(<GeneralPane />);
    expect(screen.getByRole("slider", { name: /刷新间隔/ })).toBeDisabled();
    expect(invokeMock.mock.calls.some(([command]) => String(command).startsWith("set_"))).toBe(false);

    await act(async () => {
      interval.resolve("9");
      autoStart.resolve("1");
      model.resolve("glm-loaded");
    });
    await waitFor(() => expect(screen.getByRole("slider", { name: /刷新间隔/ })).toBeEnabled());
    expect(invokeMock.mock.calls.some(([command]) => String(command).startsWith("set_"))).toBe(false);
  });

  it("加载模型列表只读取账号与模型，不会自动修改默认模型", async () => {
    mockLoadedSettings();
    render(<GeneralPane />);
    const loadButton = await screen.findByRole("button", { name: "加载可用模型" });
    await waitFor(() => expect(loadButton).toBeEnabled());
    fireEvent.click(loadButton);

    expect(await screen.findByRole("option", { name: "glm-next" })).toBeInTheDocument();
    expect(invokeMock.mock.calls.filter(([command]) => command === "set_default_model")).toHaveLength(0);
  });

  it("刷新间隔保存失败时恢复最近一次已持久化值", async () => {
    mockLoadedSettings({ rejectIntervalSave: true });
    render(<GeneralPane />);
    const slider = await screen.findByRole("slider", { name: /刷新间隔/ });
    await waitFor(() => expect(slider).toBeEnabled());
    expect(slider).toHaveValue("5");

    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: "12" } });
    expect(slider).toHaveValue("12");
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });

    expect(slider).toHaveValue("5");
    expect(screen.getByRole("alert")).toHaveTextContent("设置保存失败");
    vi.useRealTimers();
  });
});
