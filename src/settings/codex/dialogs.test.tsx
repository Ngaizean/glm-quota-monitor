import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { PasswordDialog } from "./PasswordDialog";
import { RemoteBindingDialog } from "./RemoteBindingDialog";

describe("Codex 远程弹窗", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("密码弹窗声明 dialog，Escape 关闭并恢复触发器焦点", async () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "password trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender } = render(
      <PasswordDialog
        request={{ host: "lab", mode: "push" }}
        pending={false}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "需要 SSH 密码" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <PasswordDialog request={null} pending={false} onClose={onClose} onConfirm={vi.fn()} />,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("远程绑定弹窗声明 dialog，Escape 关闭并恢复触发器焦点", async () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "binding trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    const props = {
      accounts: [],
      modelCache: {},
      pickerAccountId: null,
      pickerLoading: false,
      pending: false,
      onClose,
      onToggleAccount: vi.fn(),
      onBind: vi.fn(),
    };
    const { rerender } = render(
      <RemoteBindingDialog request={{ host: "lab" }} {...props} />,
    );

    expect(screen.getByRole("dialog", { name: /远程切换 Claude Code 端点/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<RemoteBindingDialog request={null} {...props} />);
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });
});

