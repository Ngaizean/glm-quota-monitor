import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl", () => {
  it("使用单选 tab 语义并支持方向键", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="账号详情"
        value="overview"
        options={[
          { value: "overview", label: "概览" },
          { value: "trend", label: "趋势" },
          { value: "cost", label: "成本" },
        ]}
        onValueChange={onValueChange}
      />,
    );

    const overview = screen.getByRole("tab", { name: "概览" });
    expect(overview).toHaveAttribute("aria-selected", "true");
    overview.focus();
    await user.keyboard("{ArrowRight}");
    expect(onValueChange).toHaveBeenCalledWith("trend");
  });
});
