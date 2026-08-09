import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import ExportPane from "./ExportPane";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const accounts = [{
  id: "glm-a",
  alias: ".. 研发 / A:*? <> . ",
  purpose: "test",
  platform: "zhipu",
  level: null,
  is_active: true,
  is_primary: true,
}];

describe("ExportPane", () => {
  beforeEach(async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_accounts") return Promise.resolve(accounts);
      if (command === "export_usage_csv") return Promise.resolve("time,tokens\n");
      return Promise.resolve("{}");
    });
    await i18n.changeLanguage("zh");
  });

  it("账号加载完成后仍要求用户显式选择，未选择时不能导出", async () => {
    render(<ExportPane />);
    const selector = await screen.findByRole("combobox", { name: "导出账号" });
    await waitFor(() => expect(selector).toBeEnabled());

    expect(selector).toHaveValue("");
    expect(screen.getByRole("button", { name: "导出 CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出 JSON" })).toBeDisabled();
  });

  it("清理下载文件名，并在延迟结束前保留 object URL", async () => {
    const createObjectURL = vi.fn(() => "blob:export-1");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    let cleanup: (() => void) | undefined;
    let cleanupDelay = 0;

    render(<ExportPane />);
    const selector = await screen.findByRole("combobox", { name: "导出账号" });
    await waitFor(() => expect(selector).toBeEnabled());
    fireEvent.change(selector, { target: { value: "glm-a" } });

    const nativeSetTimeout = window.setTimeout.bind(window);
    const timeout = vi.spyOn(window, "setTimeout").mockImplementation(((handler: TimerHandler, delay?: number) => {
      if ((delay ?? 0) >= 1_000 && !cleanup) {
        if (typeof handler === "function") cleanup = () => { handler(); };
        cleanupDelay = delay ?? 0;
        return 1;
      }
      return nativeSetTimeout(handler, delay);
    }) as typeof window.setTimeout);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledWith("export_usage_csv", { accountId: "glm-a" });
    expect(anchorClick).toHaveBeenCalledTimes(1);

    const anchor = document.querySelector<HTMLAnchorElement>("a[download]");
    expect(anchor?.download).toBe("glm-usage-研发-A.csv");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(cleanupDelay).toBeGreaterThanOrEqual(1_000);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    cleanup?.();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export-1");
    expect(anchor).not.toBeInTheDocument();
    timeout.mockRestore();
    anchorClick.mockRestore();
  });
});
