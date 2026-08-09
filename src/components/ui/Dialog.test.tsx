import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开详情</button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="同步详情"
        description="查看本次同步结果"
      >
        <input aria-label="详情输入框" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("用标题提供可访问名称，Escape 关闭后恢复触发器焦点", async () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "打开详情" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "同步详情" });
    expect(dialog).toHaveAccessibleDescription("查看本次同步结果");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("Tab 与 Shift+Tab 在首尾可聚焦元素之间循环", async () => {
    render(
      <Dialog
        open
        onOpenChange={vi.fn()}
        title="焦点测试"
        closeLabel="关闭焦点测试"
        footer={<button type="button">最后操作</button>}
      >
        <button type="button">中间操作</button>
      </Dialog>,
    );

    const first = screen.getByRole("button", { name: "关闭焦点测试" });
    const last = screen.getByRole("button", { name: "最后操作" });
    await waitFor(() => expect(first).toHaveFocus());

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });
});

