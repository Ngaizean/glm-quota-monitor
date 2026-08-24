import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { AccountModelPicker } from "./AgentBindingControl";
import type { AccountsController } from "./useAccountsController";

function makeController(overrides?: {
  submitCustomModel?: AccountsController["submitCustomModel"];
}): AccountsController {
  return {
    picker: { accountId: "glm-1", agent: "claude_code", loading: false, requestId: 1 },
    pickerModels: ["glm-5.2"],
    isPending: () => false,
    bindAgent: vi.fn(),
    submitCustomModel: overrides?.submitCustomModel ?? vi.fn().mockResolvedValue(true),
    closePicker: vi.fn(),
  } as unknown as AccountsController;
}

describe("AccountModelPicker 自定义模型", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("输入自定义模型提交后调用绑定并清空输入", async () => {
    const submitCustomModel = vi.fn().mockResolvedValue(true);
    render(
      <AccountModelPicker
        controller={makeController({ submitCustomModel })}
        accountId="glm-1"
        agent="claude_code"
        agentLabel="Claude Code"
        defaultModel="glm-5.2"
      />,
    );

    const input = screen.getByLabelText("自定义模型");
    expect(screen.getByRole("button", { name: "绑定" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "  glm-x  " } });
    const bindButton = screen.getByRole("button", { name: "绑定" });
    expect(bindButton).toBeEnabled();
    fireEvent.click(bindButton);

    await waitFor(() =>
      expect(submitCustomModel).toHaveBeenCalledWith("claude_code", "glm-1", "glm-x"),
    );
    await waitFor(() => expect(screen.getByLabelText("自定义模型")).toHaveValue(""));
  });

  it("绑定失败时保留输入，便于用户修改重试", async () => {
    const submitCustomModel = vi.fn().mockResolvedValue(false);
    render(
      <AccountModelPicker
        controller={makeController({ submitCustomModel })}
        accountId="glm-1"
        agent="claude_code"
        agentLabel="Claude Code"
        defaultModel="glm-5.2"
      />,
    );

    fireEvent.change(screen.getByLabelText("自定义模型"), { target: { value: "glm-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "绑定" }));

    await waitFor(() => expect(submitCustomModel).toHaveBeenCalled());
    expect(screen.getByLabelText("自定义模型")).toHaveValue("glm-bad");
  });

  it("picker 未展开时不渲染任何内容", () => {
    const controller = makeController();
    controller.picker = null;
    const { container } = render(
      <AccountModelPicker
        controller={controller}
        accountId="glm-1"
        agent="claude_code"
        agentLabel="Claude Code"
        defaultModel="glm-5.2"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("allowCustomModel=false（DeepSeek 账号）不渲染自定义模型表单", () => {
    const controller = makeController();
    controller.picker = { accountId: "ds-1", agent: "claude_code", loading: false, requestId: 1 };
    controller.pickerModels = ["deepseek-chat"];
    render(
      <AccountModelPicker
        controller={controller}
        accountId="ds-1"
        agent="claude_code"
        agentLabel="Claude Code"
        defaultModel="deepseek-v4-flash"
        allowCustomModel={false}
      />,
    );
    // 模型列表仍在
    expect(screen.getByText("deepseek-chat")).toBeInTheDocument();
    // 但没有自定义输入与提交按钮
    expect(screen.queryByLabelText("自定义模型")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "绑定" })).not.toBeInTheDocument();
  });
});
