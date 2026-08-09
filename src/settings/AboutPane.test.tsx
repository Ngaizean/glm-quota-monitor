import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import AboutPane from "./AboutPane";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  check: vi.fn(),
  relaunch: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

describe("AboutPane", () => {
  beforeEach(async () => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getVersion.mockResolvedValue("9.8.7");
    await i18n.changeLanguage("zh");
  });

  it("StrictMode 下只进行合理次数的只读版本查询", async () => {
    render(<StrictMode><AboutPane /></StrictMode>);
    expect(await screen.findByText("v9.8.7")).toBeInTheDocument();

    expect(mocks.getVersion.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mocks.getVersion.mock.calls.length).toBeLessThanOrEqual(2);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("无法连接更新服务器时显示网络错误，而不是无更新源", async () => {
    mocks.check.mockRejectedValue(new TypeError("Could not fetch"));
    render(<AboutPane />);
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("网络连接失败");
    expect(screen.queryByText(/暂无可用更新源/)).not.toBeInTheDocument();
  });

  it("更新端点明确返回缺失时显示无更新源", async () => {
    mocks.check.mockRejectedValue(new Error("release JSON returned 404 not found"));
    render(<AboutPane />);
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText(/暂无可用更新源/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/网络连接失败/)).not.toBeInTheDocument());
  });
});

