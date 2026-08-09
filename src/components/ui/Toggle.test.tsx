import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("暴露 switch 状态和可访问名称", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Toggle
        aria-label="自动刷新"
        checked
        onCheckedChange={onCheckedChange}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "自动刷新" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("disabled 时不触发变更", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Toggle
        aria-label="自动刷新"
        checked={false}
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "自动刷新" }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
