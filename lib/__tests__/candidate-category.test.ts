import { describe, expect, it } from "vitest";
import { detourCategory } from "@/lib/candidate-category";
import type { Candidate } from "@/lib/meeting/types";

const c = (detourA: number, detourB: number): Candidate => ({
  groupId: "g",
  stationId: "s",
  name: "駅",
  lat: 35,
  lng: 139,
  line: "L線",
  operator: "OpA",
  detourA,
  detourB,
  shared: 10,
  isDestination: false,
});

describe("detourCategory", () => {
  it("二人とも遠回りが無ければ none、片方だけなら a か b、二人ともなら both", () => {
    expect(detourCategory(c(0, 0))).toBe("none");
    expect(detourCategory(c(120, 0))).toBe("a");
    expect(detourCategory(c(0, 3.4))).toBe("b");
    expect(detourCategory(c(50, 40))).toBe("both");
  });

  it("表で 0.0km と出るほど小さい距離の遠回り（計算誤差）は遠回りなしとみなす", () => {
    expect(detourCategory(c(1e-12, 0.04))).toBe("none");
  });
});
