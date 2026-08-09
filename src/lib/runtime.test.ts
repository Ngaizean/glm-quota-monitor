import { afterEach, describe, expect, it } from "vitest";
import { getPreviewPage, isPreviewMode, isPreviewRequest } from "./runtime";

describe("runtime preview guard", () => {
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("只有 DEV 与 preview query 同时满足才允许预览", () => {
    expect(isPreviewRequest(false, "?preview=quota")).toBe(false);
    expect(isPreviewRequest(true, "")).toBe(false);
    expect(isPreviewRequest(true, "?preview=quota")).toBe(true);
  });

  it("实际运行时读取 query 并解析页面", () => {
    window.history.replaceState({}, "", "/?preview=settings");

    expect(isPreviewMode()).toBe(true);
    expect(getPreviewPage()).toBe("settings");
  });
});
