import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AlertRuleRow } from "./AlertRuleRow";
import type { AlertRule } from "./types";

const percentRule: AlertRule = {
  id: 1,
  rule_type: "token_5h",
  threshold: 60,
  enabled: true,
  account_id: null,
  dedupe_window_mins: 60,
};

describe("AlertRuleRow", () => {
  it("拖动滑块只更新草稿，在 pointer-up 或 blur 时提交最终值", () => {
    const onUpdate = vi.fn();
    render(<AlertRuleRow rule={percentRule} onUpdate={onUpdate} />);
    const slider = screen.getByRole("slider");

    fireEvent.change(slider, { target: { value: "76" } });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(onUpdate).toHaveBeenLastCalledWith({ threshold: 76 });

    fireEvent.change(slider, { target: { value: "81" } });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    fireEvent.blur(slider);
    expect(onUpdate).toHaveBeenLastCalledWith({ threshold: 81 });
  });
});
