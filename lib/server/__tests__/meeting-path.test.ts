import { describe, expect, it } from "vitest";
import type { GraphEdge, StationNode } from "@/lib/graph/types";
import { createGraphStore } from "@/lib/server/graph-store";
import { meetingPath } from "@/lib/server/meeting-service";

// 駅ごとに経度をずらし、座標の並びで経路を読めるようにする
const lng: Record<string, number> = { A: 0, J: 1, D: 2, M: 3, Ab: 4, Mb: 5 };
const node = (id: string, operator = "OpA"): StationNode => ({
  id,
  groupId: id,
  name: id,
  lat: 35,
  lng: lng[id] ?? 0,
  lineId: "L",
  lineName: "L",
  operator,
});
const rail = (from: string, to: string, km: number, operator = "OpA") =>
  ({ from, to, km, kind: "rail", operator }) satisfies GraphEdge;
const transfer = (from: string, to: string) =>
  ({ from, to, km: 0, kind: "transfer", operator: "" }) satisfies GraphEdge;

// OpA 本線 A -10- J -10- D と枝 J -3- M。OpB の近道 A=Ab -9- Mb=M
const store = createGraphStore(
  {
    nodes: {
      A: node("A"),
      J: node("J"),
      D: node("D"),
      M: node("M"),
      Ab: node("Ab", "OpB"),
      Mb: node("Mb", "OpB"),
    },
    edges: [
      rail("A", "J", 10),
      rail("J", "D", 10),
      rail("J", "M", 3),
      transfer("A", "Ab"),
      rail("Ab", "Mb", 9, "OpB"),
      transfer("Mb", "M"),
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
const xs = (pts: [number, number][]) => pts.map(([x]) => x);

describe("meetingPath", () => {
  it("距離の物差しでは、営業キロ最短の3区間の座標を返す", () => {
    const r = meetingPath(store, {
      a: "A",
      b: "A",
      to: "D",
      via: "M",
      metric: "km",
    });
    // A→M は OpB の近道（A, Ab, Mb, M）、M→D は M, J, D
    expect(xs(r.legs.a)).toEqual([0, 4, 5, 3]);
    expect(xs(r.legs.shared)).toEqual([3, 1, 2]);
  });

  it("料金の物差しで via が最安経路から外れていれば、運賃を精査したのと同じ乗り換えない経路の座標を返す", () => {
    const r = meetingPath(
      store,
      { a: "A", b: "A", to: "D", via: "M", metric: "fare" },
      { a: ["A", "J", "D"], b: ["A", "J", "D"] },
    );
    expect(xs(r.legs.a)).toEqual([0, 1, 3]);
    expect(xs(r.legs.shared)).toEqual([3, 1, 2]);
  });

  it("料金の物差しで via が最安経路上なら、最安経路を via で区切った座標を返す", () => {
    // 最安経路は A, Ab, Mb, M, J, D（運賃の探索がそう返したとする）
    const r = meetingPath(
      store,
      { a: "A", b: "A", to: "D", via: "M", metric: "fare" },
      {
        a: ["A", "Ab", "Mb", "M", "J", "D"],
        b: ["A", "Ab", "Mb", "M", "J", "D"],
      },
    );
    expect(xs(r.legs.a)).toEqual([0, 4, 5, 3]);
    expect(xs(r.legs.shared)).toEqual([3, 1, 2]);
  });
});
