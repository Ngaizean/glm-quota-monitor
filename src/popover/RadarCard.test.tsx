import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RadarCard from "./RadarCard";

describe("RadarCard", () => {
  it("shows the Codex station daily and hard-problem recommendations", () => {
    render(
      <RadarCard
        data={{
          best_model: "GPT-5.6 Sol max",
          best_score: 102.7,
          probability_24h: 0.14,
          probability_level: "low",
          updated_at: "2026-08-24T02:10:48+00:00",
          daily_models: ["GPT-5.6 Sol medium", "GPT-5.6 Sol high"],
          hard_problem_models: ["GPT-5.6 Sol ultra", "GPT-5.6 Sol max"],
        }}
        refreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("日常开发")).toBeInTheDocument();
    expect(screen.getByText("GPT-5.6 Sol medium · GPT-5.6 Sol high")).toBeInTheDocument();
    expect(screen.getByText("难题攻坚")).toBeInTheDocument();
    expect(screen.getByText("GPT-5.6 Sol ultra · GPT-5.6 Sol max")).toBeInTheDocument();
  });
});
