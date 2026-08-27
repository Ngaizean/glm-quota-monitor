import { render, screen } from "@testing-library/react";
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
vi.mock("./RelayUsagePanel", () => ({ default: () => <div>中转用量详情</div> }));

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

  it("Codex 中转账号显示余额并在展开后展示中转用量", () => {
    render(
      <AccountList
        accounts={[{
          id: "relay-1",
          alias: "Codex 中转",
          purpose: "codex",
          platform: "codex",
          level: "钱包余额",
          is_active: true,
          is_primary: true,
        }]}
        expandedIds={new Set(["relay-1"])}
        onToggle={() => undefined}
        onSetPrimary={() => undefined}
        quotas={{
          "relay-1": {
            limits: [{ type: "RELAY_BALANCE", percentage: 0, nextResetTime: 0, currentValue: 480 }],
            level: "钱包余额",
            last_active: null,
          },
        }}
        loading={false}
        refreshKey={0}
      />,
    );

    expect(screen.getByTitle("中转站余额")).toHaveTextContent("C480");
    expect(screen.getByText("中转用量详情")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});
