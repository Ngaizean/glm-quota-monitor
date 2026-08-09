import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AccountList from "./AccountList";

vi.mock("./CostBar", () => ({ default: () => null }));
vi.mock("./QuotaSection", () => ({ default: () => null }));
vi.mock("./UsageSummary", () => ({ default: () => null }));
vi.mock("./ToolUsageSection", () => ({ default: () => null }));
vi.mock("./TrendChart", () => ({ default: () => null }));
vi.mock("./DeepSeekBalanceBar", () => ({ default: () => null }));
vi.mock("./DeepSeekModelList", () => ({ default: () => null }));
vi.mock("./DeepSeekBalanceChart", () => ({ default: () => null }));

describe("AccountList", () => {
  it("展开与收藏操作不产生嵌套按钮", () => {
    const { container } = render(
      <AccountList
        accounts={[{
          id: "a1",
          alias: "一个非常长的工作账号名称",
          purpose: "work",
          platform: "zhipu",
          level: "pro",
          is_active: true,
          is_primary: true,
        }]}
        expandedIds={new Set()}
        onToggle={() => undefined}
        onSetPrimary={() => undefined}
        quotas={{ a1: { limits: [], level: "pro", last_active: null } }}
        loading={false}
        refreshKey={0}
      />,
    );

    expect(container.querySelector("button button")).toBeNull();
    expect(container.querySelector('[role="tabpanel"]')).toBeNull();
  });
});
