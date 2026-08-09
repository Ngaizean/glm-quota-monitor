import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import CodexPane from "../CodexPane";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function baseValue(command: string): unknown {
  const values: Record<string, unknown> = {
    get_codex_role: "owner",
    get_codex_gist_url: "https://gist.example/raw",
    read_local_codex_auth: { exists: true, account_id: "a", last_refresh: null, access_token_exp: null },
    get_codex_sync_info: { last_upload: null, last_sync: null },
    get_codex_auto_upload: false,
    get_codex_proxy: "",
    get_codex_auto_sync: true,
    get_ssh_override_state: [],
    list_accounts: [],
  };
  return values[command];
}

describe("CodexPane 交互边界", () => {
  beforeEach(async () => {
    invokeMock.mockReset();
    await i18n.changeLanguage("zh");
  });

  it("初始化完成前禁用所有 mutation 入口", async () => {
    const roleLoad = deferred<string>();
    invokeMock.mockImplementation((command: string) => (
      command === "get_codex_role" ? roleLoad.promise : Promise.resolve(baseValue(command))
    ));

    render(<CodexPane />);
    const consumerTab = screen.getByRole("tab", { name: /接收者/ });
    expect(consumerTab).toBeDisabled();
    fireEvent.click(consumerTab);
    expect(invokeMock).not.toHaveBeenCalledWith("set_codex_role", expect.anything());

    roleLoad.resolve("owner");
    await waitFor(() => expect(consumerTab).toBeEnabled());
  });

  it("展开高级设置才读取 Token，折叠后再次展开会重新读取", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_codex_github_token") return Promise.resolve("token-secret");
      return Promise.resolve(baseValue(command));
    });
    render(<CodexPane />);
    await waitFor(() => expect(screen.getByRole("button", { name: "显示连接配置" })).toBeEnabled());
    expect(invokeMock).not.toHaveBeenCalledWith("get_codex_github_token");

    fireEvent.click(screen.getByRole("button", { name: "显示连接配置" }));
    const tokenInput = await screen.findByLabelText("GitHub Token");
    await waitFor(() => expect(tokenInput).toHaveValue("token-secret"));
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_codex_github_token")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "收起连接配置" }));
    expect(screen.queryByLabelText("GitHub Token")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示连接配置" }));
    await waitFor(() => {
      expect(invokeMock.mock.calls.filter(([command]) => command === "get_codex_github_token")).toHaveLength(2);
    });
  });

  it("角色保存期间只禁用角色控件", async () => {
    const roleWrite = deferred<void>();
    invokeMock.mockImplementation((command: string) => {
      if (command === "set_codex_role") return roleWrite.promise;
      return Promise.resolve(baseValue(command));
    });
    render(<CodexPane />);
    const consumerTab = await screen.findByRole("tab", { name: /接收者/ });
    await waitFor(() => expect(consumerTab).toBeEnabled());

    fireEvent.click(consumerTab);
    expect(consumerTab).toBeDisabled();
    expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled();
    roleWrite.resolve();
    await waitFor(() => expect(consumerTab).toBeEnabled());
  });

  it.each([
    ["owner", "自动上传", "set_codex_auto_upload"],
    ["consumer", "自动同步", "set_codex_auto_sync"],
  ])("%s 模式下开关保存期间禁用对应控件", async (role, label, commandName) => {
    const write = deferred<void>();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_codex_role") return Promise.resolve(role);
      if (command === commandName) return write.promise;
      return Promise.resolve(baseValue(command));
    });
    render(<CodexPane />);
    const toggle = await screen.findByRole("switch", { name: label });
    await waitFor(() => expect(toggle).toBeEnabled());

    fireEvent.click(toggle);
    expect(toggle).toBeDisabled();
    write.resolve();
    await waitFor(() => expect(toggle).toBeEnabled());
  });

  it("SSH 免密检测异常会显示为页面错误，而不是未处理 Promise", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "scan_ssh_hosts") {
        return Promise.resolve([{
          alias: "lab", hostname: "lab.local", user: "dev", port: 22,
          identity_file: null, has_local_key: true,
        }]);
      }
      if (command === "ssh_check_claude_code") {
        return Promise.resolve({ installed: false, base_url: null, model: null, platform: "unknown" });
      }
      if (command === "check_ssh_passwordless") return Promise.reject(new Error("passwordless probe failed"));
      return Promise.resolve(baseValue(command));
    });

    render(<CodexPane />);
    await waitFor(() => expect(screen.getByRole("button", { name: "扫描主机" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "扫描主机" }));
    await screen.findByText("lab");
    fireEvent.click(screen.getByRole("button", { name: "推送" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("passwordless probe failed");
  });
});
