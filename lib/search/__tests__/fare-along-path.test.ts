import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import type { GraphEdge, RailGraph } from "@/lib/graph/types";
import { fareAlongPath } from "@/lib/search/fare-along-path";
import { findReachable } from "@/lib/search/reachable";

// 非線形な表にして、「距離を合算して1回引く」と「区間ごとに引いて足す」が別の額になるようにする
const calc = createFareCalculator([
  {
    id: "test",
    operators: [],
    table: [
      [10, 100],
      [20, 150],
      [30, 300],
    ],
    beyond: { fromKm: 30, baseFare: 300, ratePerKm: 10 },
  },
]);

const node = (id: string, operator = "OpA") => ({
  id,
  groupId: id,
  name: id,
  lat: 35,
  lng: 139,
  lineId: "L",
  lineName: "L",
  operator,
});

const rail = (
  from: string,
  to: string,
  km: number,
  operator = "OpA",
): GraphEdge => ({ from, to, km, kind: "rail", operator });

describe("fareAlongPath", () => {
  it("1事業者だけの経路では、合計距離で運賃表を引いた額になる", () => {
    const edges = [rail("A", "B", 5), rail("B", "C", 7)];
    const graph: RailGraph = {
      nodes: { A: node("A"), B: node("B"), C: node("C") },
      edges,
    };
    expect(fareAlongPath(graph, calc, "A", edges)).toBe(
      calc.estimate("OpA", 12),
    );
  });

  it("事業者が切り替わると、区間ごとに引いた運賃の合計になる", () => {
    const edges = [rail("A", "B", 10), rail("B", "C", 10, "OpB")];
    const graph: RailGraph = {
      nodes: { A: node("A"), B: node("B"), C: node("C", "OpB") },
      edges,
    };
    // 合算 20km なら 150 円、10km を2回なら 200 円
    expect(fareAlongPath(graph, calc, "A", edges)).toBe(200);
  });

  it("JR本州3社の会社境界をまたぐと、findReachable がその駅に出す通し運賃と同じになる", () => {
    const honshuCalc = createFareCalculator([
      {
        id: "fallback",
        operators: [],
        table: [[10, 999999]],
        beyond: { fromKm: 10, baseFare: 999999, ratePerKm: 1 },
      },
      {
        id: "jr-central",
        operators: ["JR東海"],
        table: [
          [10, 100],
          [20, 150],
        ],
        beyond: { fromKm: 20, baseFare: 150, ratePerKm: 5 },
      },
      {
        id: "jr-east",
        operators: ["JR東日本"],
        table: [
          [10, 120],
          [20, 200],
        ],
        beyond: { fromKm: 20, baseFare: 200, ratePerKm: 8 },
      },
      {
        id: "jr-honshu-kasan",
        operators: ["__jr-honshu-kasan"],
        table: [
          [10, 10],
          [20, 20],
        ],
        beyond: { fromKm: 20, baseFare: 20, ratePerKm: 0 },
      },
    ]);
    const edges = [
      rail("A", "B", 10, "JR東日本"),
      rail("B", "C", 10, "JR東海"),
    ];
    const graph: RailGraph = {
      nodes: {
        A: node("A", "JR東日本"),
        B: node("B", "JR東日本"),
        C: node("C", "JR東海"),
      },
      edges,
    };
    const searched = findReachable(graph, honshuCalc, "A", 10000).find(
      (r) => r.id === "C",
    )?.fare;
    // 基準額(20km)=150 + 加算額(10km)=10
    expect(searched).toBe(160);
    expect(fareAlongPath(graph, honshuCalc, "A", edges)).toBe(searched);
  });

  it("空の経路は 0 円", () => {
    const graph: RailGraph = { nodes: { A: node("A") }, edges: [] };
    expect(fareAlongPath(graph, calc, "A", [])).toBe(0);
  });
});
