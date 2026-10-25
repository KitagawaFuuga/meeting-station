import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import type { RailGraph } from "@/lib/graph/types";
import { findCheapestPath, findReachable } from "@/lib/search/reachable";

// OpA は 10km 100円、OpB は 10km まで 80円・以降 1km 5円
const calc = createFareCalculator([
  {
    id: "test",
    operators: [],
    table: [
      [10, 100],
      [20, 150],
    ],
    beyond: { fromKm: 20, baseFare: 150, ratePerKm: 10 },
  },
  {
    id: "opb",
    operators: ["OpB"],
    table: [[10, 80]],
    beyond: { fromKm: 10, baseFare: 80, ratePerKm: 5 },
  },
]);

const node = (id: string, operator: string, groupId = id) => ({
  id,
  groupId,
  name: id,
  lat: 35,
  lng: 139,
  lineId: "L",
  lineName: "L",
  operator,
});

// s -OpA 10km- goal（100円）と、s -OpB 4km- p1 -4km- p2 -4km- goal2（12km、90円）。
// goal と goal2 は同じ駅グループ。営業キロでは直通が短いが、運賃は OpB 経由が安い
const graph: RailGraph = {
  nodes: {
    s: node("s", "OpA"),
    goal: node("goal", "OpA", "g-goal"),
    p1: node("p1", "OpB"),
    p2: node("p2", "OpB"),
    goal2: node("goal2", "OpB", "g-goal"),
  },
  edges: [
    { from: "s", to: "goal", km: 10, kind: "rail", operator: "OpA" },
    { from: "s", to: "p1", km: 4, kind: "rail", operator: "OpB" },
    { from: "p1", to: "p2", km: 4, kind: "rail", operator: "OpB" },
    { from: "p2", to: "goal2", km: 4, kind: "rail", operator: "OpB" },
  ],
};

describe("findCheapestPath", () => {
  it("営業キロでは遠回りでも安い経路があるとき、その経路の駅の並びを返す", () => {
    const r = findCheapestPath(graph, calc, "s", "g-goal", 1000);
    expect(r?.nodeIds).toEqual(["s", "p1", "p2", "goal2"]);
  });

  it("fare は findReachable がその駅に出す最安額と同じになる", () => {
    const searched = findReachable(graph, calc, "s", 1000).find(
      (x) => x.id === "goal2",
    )?.fare;
    expect(searched).toBe(90);
    expect(findCheapestPath(graph, calc, "s", "g-goal", 1000)?.fare).toBe(
      searched,
    );
  });

  it("予算内に着けなければ null を返す", () => {
    expect(findCheapestPath(graph, calc, "s", "g-goal", 50)).toBeNull();
  });
});
