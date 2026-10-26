import { describe, expect, it } from "vitest";
import type { FareRule } from "@/lib/fare/types";
import type { GraphEdge, RailGraph, StationNode } from "@/lib/graph/types";
import { findMeetingCandidates } from "@/lib/meeting/candidates";
import { UnreachableError } from "@/lib/meeting/types";
import { createGraphStore } from "@/lib/server/graph-store";

// OpA: 10km 100円、20km 150円、30km 300円、以降 1km 10円
const rules: FareRule[] = [
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
];

const node = (id: string, groupId = id): StationNode => ({
  id,
  groupId,
  name: id,
  lat: 35,
  lng: 139,
  lineId: "L",
  lineName: "L線",
  operator: "OpA",
});

const rail = (from: string, to: string, km: number): GraphEdge => ({
  from,
  to,
  km,
  kind: "rail",
  operator: "OpA",
});

// Z -10- A -10- x -10- M -10- D、B -10- M
const lineGraph: RailGraph = {
  nodes: Object.fromEntries(
    ["Z", "A", "x", "M", "D", "B"].map((id) => [id, node(id)]),
  ),
  edges: [
    rail("Z", "A", 10),
    rail("A", "x", 10),
    rail("x", "M", 10),
    rail("M", "D", 10),
    rail("B", "M", 10),
  ],
};
const store = createGraphStore(lineGraph, rules);

describe("findMeetingCandidates", () => {
  it("二人の経路が重なる駅では、距離の遠回りが二人とも 0 になる", () => {
    const m = findMeetingCandidates(store, "A", "B", "D").km.find(
      (c) => c.groupId === "M",
    );
    expect(m).toMatchObject({ detourA: 0, detourB: 0 });
  });

  it("A の背後の駅は、A の遠回りが直接の距離の半分を超えるので候補に入らない", () => {
    // A→D は 30km。Z 経由は 10 + 40 = 50km で遠回り 20km（上限 15km）
    const km = findMeetingCandidates(store, "A", "B", "D").km;
    expect(km.some((c) => c.groupId === "Z")).toBe(false);
  });

  it("目的駅の先にある駅は、遠回りが半分以内でも候補に入らない", () => {
    // D の先 5km の E。A の遠回りは 10km（上限 15km）だが、二人とも目的駅を通り過ぎてから落ち合うことになる
    const g = createGraphStore(
      {
        nodes: { ...lineGraph.nodes, E: node("E") },
        edges: [...lineGraph.edges, rail("D", "E", 5)],
      },
      rules,
    );
    const r = findMeetingCandidates(g, "A", "B", "D");
    expect(r.km.some((c) => c.groupId === "E")).toBe(false);
    expect(r.fare.some((c) => c.groupId === "E")).toBe(false);
  });

  it("目的駅は isDestination が true、一緒に乗る区間が 0 で必ず入る", () => {
    const d = findMeetingCandidates(store, "A", "B", "D").km.find(
      (c) => c.groupId === "D",
    );
    expect(d).toMatchObject({ isDestination: true, shared: 0 });
  });

  it("料金の物差しでは、最安経路上の駅の遠回りが 0 円になる", () => {
    const m = findMeetingCandidates(store, "A", "B", "D").fare.find(
      (c) => c.groupId === "M",
    );
    expect(m).toMatchObject({ detourA: 0, detourB: 0 });
  });

  it("料金の物差しでは、最安経路から外れた駅は営業キロ最短の経路に沿った運賃で遠回りを出す", () => {
    // 1km 100円、以降 1km 10円の一次式。A -10- P -10- D、P -2- Y（枝）
    const linear = createGraphStore(
      {
        nodes: Object.fromEntries(
          ["A", "P", "D", "Y"].map((id) => [id, node(id)]),
        ),
        edges: [rail("A", "P", 10), rail("P", "D", 10), rail("P", "Y", 2)],
      },
      [
        {
          id: "linear",
          operators: [],
          table: [[1, 100]],
          beyond: { fromKm: 1, baseFare: 100, ratePerKm: 10 },
        },
      ],
    );
    const y = findMeetingCandidates(linear, "A", "A", "D").fare.find(
      (c) => c.groupId === "Y",
    );
    // 直接 20km = 290円、Y 経由 24km = 330円
    expect(y?.detourA).toBe(40);
  });

  it("料金の精査では、営業キロが少し短くても事業者を乗り継ぐ経路より、乗り換えない経路の運賃を使う", () => {
    // OpA 本線 A -10- J -10- D と枝 J -3- M。OpB の近道 A=Ab -9- Mb=M（= は事業者が変わる乗換）。
    // 営業キロ最短の A→M は OpB 経由（9km）で、OpB 9km 180円 + OpA 13km 220円 = 400円（遠回り 110円）。
    // 乗り換えずに OpA だけで行けば 26km 350円（遠回り 60円）
    const opB = (id: string) => ({ ...node(id), operator: "OpB" });
    const g = createGraphStore(
      {
        nodes: {
          ...Object.fromEntries(
            ["A", "J", "D", "M"].map((id) => [id, node(id)]),
          ),
          Ab: opB("Ab"),
          Mb: opB("Mb"),
        },
        edges: [
          rail("A", "J", 10),
          rail("J", "D", 10),
          rail("J", "M", 3),
          { from: "A", to: "Ab", km: 0, kind: "transfer", operator: "" },
          { from: "Ab", to: "Mb", km: 9, kind: "rail", operator: "OpB" },
          { from: "Mb", to: "M", km: 0, kind: "transfer", operator: "" },
        ],
      },
      [
        {
          id: "linear",
          operators: [],
          table: [[1, 100]],
          beyond: { fromKm: 1, baseFare: 100, ratePerKm: 10 },
        },
      ],
    );
    const m = findMeetingCandidates(g, "A", "A", "D").fare.find(
      (c) => c.groupId === "M",
    );
    expect(m?.detourA).toBe(60);
  });

  it("遠回りが計算誤差などで負に出ても 0 にする", () => {
    // 0.1 + (0.2 + 0.3) と (0.1 + 0.2) + 0.3 は浮動小数点で一致せず、x の遠回りが -1e-16 になる
    const g = createGraphStore(
      {
        nodes: Object.fromEntries(
          ["A", "x", "M", "D"].map((id) => [id, node(id)]),
        ),
        edges: [rail("A", "x", 0.1), rail("x", "M", 0.2), rail("M", "D", 0.3)],
      },
      rules,
    );
    const x = findMeetingCandidates(g, "A", "A", "D").km.find(
      (c) => c.groupId === "x",
    );
    expect(Object.is(x?.detourA, 0)).toBe(true);
  });

  it("同じ駅グループの別路線ノードは1候補にまとまる", () => {
    // M と M2 は同じ駅の別ホーム（groupId が同じ、0km の乗換で結ぶ）
    const g = createGraphStore(
      {
        nodes: {
          ...lineGraph.nodes,
          M2: node("M2", "M"),
          M: node("M", "M"),
        },
        edges: [
          ...lineGraph.edges,
          { from: "M", to: "M2", km: 0, kind: "transfer", operator: "" },
        ],
      },
      rules,
    );
    const r = findMeetingCandidates(g, "A", "B", "D");
    expect(r.km.filter((c) => c.groupId === "M")).toHaveLength(1);
    expect(r.fare.filter((c) => c.groupId === "M")).toHaveLength(1);
  });

  it("A と B が同じ駅なら、経路上の候補は二人とも遠回り 0 になる", () => {
    const r = findMeetingCandidates(store, "A", "A", "D");
    const onPath = ["A", "x", "M", "D"].map((g) =>
      r.km.find((c) => c.groupId === g),
    );
    expect(onPath.map((c) => [c?.detourA, c?.detourB])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it("目的駅に線路でつながっていなければ UnreachableError を投げる", () => {
    const g = createGraphStore(
      {
        nodes: { ...lineGraph.nodes, island: node("island") },
        edges: lineGraph.edges,
      },
      rules,
    );
    expect(() => findMeetingCandidates(g, "island", "B", "D")).toThrow(
      UnreachableError,
    );
  });
});
