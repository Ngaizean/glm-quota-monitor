import { afterEach, describe, expect, it } from "vitest";
import { initializeAppearance } from "./theme";

describe("initializeAppearance", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-mode");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("lang");
  });

  it("在 React 挂载前恢复模式、强调色和语言", () => {
    localStorage.setItem("theme-mode", "dark");
    localStorage.setItem("theme", "ocean");
    localStorage.setItem("lang", "en");

    initializeAppearance();

    expect(document.documentElement).toHaveAttribute("data-mode", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "ocean");
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("system 和 default 不留下强制属性", () => {
    document.documentElement.setAttribute("data-mode", "dark");
    document.documentElement.setAttribute("data-theme", "forest");
    localStorage.setItem("theme-mode", "system");
    localStorage.setItem("theme", "default");

    initializeAppearance();

    expect(document.documentElement).not.toHaveAttribute("data-mode");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
  });
});
