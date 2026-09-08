import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import RemoteDevicesPane from "./RemoteDevicesPane";
import CloudSyncPane from "./CloudSyncPane";
import type { DistributionState } from "./types";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));
let data: DistributionState;
beforeEach(() => {
  data = {
    accounts: [
      {
        account_id: "official",
        alias: "官方账号",
        kind: "official",
        base_url: "",
        model: "",
        reasoning_effort: "",
      },
      {
        account_id: "relay",
        alias: "中转账号",
        kind: "relay",
        base_url: "https://relay.example/v1",
        model: "gpt-test",
        reasoning_effort: "high",
      },
    ],
    devices: [],
    local_account_id: "official",
    cloud_account_id: "relay",
    cloud_account_ids: ["relay"],
  };
  invokeMock.mockReset();
  invokeMock.mockImplementation(
    async (command: string, args?: { device?: unknown; accountIds?: unknown }) => {
      const values: Record<string, unknown> = {
        get_distribution_state: data,
        scan_ssh_hosts: [
          { alias: "server", hostname: "example", user: "user", port: 22 },
        ],
        get_codex_role: "owner",
        get_codex_gist_url: "https://gist.example",
        get_codex_proxy: "",
        get_codex_auto_upload: false,
        get_codex_auto_sync: true,
        get_codex_sync_info: { last_upload: null, last_sync: null },
        has_ssh_password: true,
        ssh_check_codex: true,
      };
      if (command === "bind_codex_device")
        data = {
          ...data,
          devices: [args?.device as DistributionState["devices"][number]],
        };
      if (command === "set_cloud_accounts")
        data = {
          ...data,
          cloud_account_ids: (args?.accountIds ?? []) as string[],
        };
      return values[command];
    },
  );
});

describe("账号分发", () => {
  it("新设备未绑定时禁止推送，保存选定中转账号后才允许同步", async () => {
    render(<RemoteDevicesPane />);
    expect(
      await screen.findByRole("button", { name: "立即同步" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "绑定账号" }));
    fireEvent.change(screen.getByRole("combobox", { name: "选择账号" }), {
      target: { value: "relay" },
    });
    fireEvent.change(screen.getByLabelText("设备模型"), {
      target: { value: "gpt-device" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("bind_codex_device", {
        device: expect.objectContaining({
          account_id: "relay",
          follow_local: false,
          model: "gpt-device",
        }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "立即同步" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("sync_codex_device", {
        host: "server",
        password: null,
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "switch_codex_runtime",
      expect.anything(),
    );
  });

  it("远端未安装 Codex 时显示不支持并禁止绑定保存", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === "ssh_check_codex"
        ? false
        : command === "get_distribution_state"
          ? data
          : command === "scan_ssh_hosts"
            ? [{ alias: "server", hostname: "example", user: "user", port: 22 }]
            : undefined,
    );
    render(<RemoteDevicesPane />);
    fireEvent.click(await screen.findByRole("button", { name: "绑定账号" }));
    expect(
      await screen.findByText("目标服务器未安装 Codex，不支持账号同步"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("绑定失败时保留编辑内容且不会误显示已保存", async () => {
    const original = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation((command, args) =>
      command === "bind_codex_device"
        ? Promise.reject("写入失败")
        : original(command, args),
    );
    render(<RemoteDevicesPane />);
    fireEvent.click(await screen.findByRole("button", { name: "绑定账号" }));
    fireEvent.change(screen.getByRole("combobox", { name: "选择账号" }), {
      target: { value: "relay" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent("写入失败"),
    );
    expect(screen.getByRole("combobox", { name: "选择账号" })).toHaveValue(
      "relay",
    );
  });

  it("云端发布选定账号，不读取或改变本机运行配置", async () => {
    render(<CloudSyncPane />);
    const relayBox = await screen.findByRole("checkbox", {
      name: /中转账号/,
    });
    expect(relayBox).toBeChecked();
    // 追加勾选官方账号 → 保存多账号集合
    fireEvent.click(screen.getByRole("checkbox", { name: /官方账号/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_cloud_accounts", {
        accountIds: ["relay", "official"],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "发布账号与配置" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("upload_codex_auth"),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("get_codex_runtime_config");
    expect(invokeMock).not.toHaveBeenCalledWith("get_codex_github_token");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "set_codex_github_token",
      expect.anything(),
    );
  });
});
