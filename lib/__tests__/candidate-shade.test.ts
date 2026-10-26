import { describe, expect, it } from "vitest";
import { CANDIDATE_SHADES, shadeIndex } from "@/lib/candidate-shade";

describe("shadeIndex", () => {
  it("表の順位が上の候補ほど濃い段階、下の候補ほど淡い段階になる", () => {
    expect(shadeIndex(0, 100)).toBe(0);
    expect(shadeIndex(99, 100)).toBe(CANDIDATE_SHADES.length - 1);
  });

  it("候補が1件だけでも、範囲外の順位でも、段階は色の数の範囲に収まる", () => {
    expect(shadeIndex(0, 1)).toBe(0);
    expect(shadeIndex(3, 3)).toBe(CANDIDATE_SHADES.length - 1);
  });
});
