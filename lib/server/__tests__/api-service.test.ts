import { describe, expect, it } from "vitest";
import { createGraphStore } from "@/lib/server/graph-store";
import { suggestStations } from "@/lib/server/api-service";
import type { RailGraph } from "@/lib/graph/types";

const node = (
  id: string,
  name: string,
  lat: number,
  lng: number,
  groupId = id,
  lineName = "テスト線",
) => ({
  id,
  groupId,
  name,
  lat,
  lng,
  lineId: "L1",
  lineName,
  operator: "テスト鉄道",
});

// S1/S3 は同一グループ（新宿の別路線ノード）、S2/S4 も同一グループ（代々木の別路線ノード）
const graph: RailGraph = {
  nodes: {
    S1: node("S1", "新宿", 35.69, 139.7, "G_SHINJUKU"),
    S2: node("S2", "代々木", 35.683, 139.702, "G_YOYOGI"),
    S3: node("S3", "新宿", 35.691, 139.699, "G_SHINJUKU", "テスト線2"),
    S4: node("S4", "代々木", 35.686, 139.705, "G_YOYOGI", "テスト線2"),
  },
  edges: [
    { from: "S1", to: "S2", km: 0.7, kind: "rail", operator: "テスト鉄道" },
    { from: "S1", to: "S3", km: 0, kind: "transfer", operator: "" },
    { from: "S1", to: "S4", km: 2, kind: "rail", operator: "テスト鉄道" },
  ],
};
const rules = [
  {
    id: "t",
    operators: [],
    table: [
      [1, 150],
      [3, 300],
    ] as [number, number][],
    beyond: { fromKm: 3, baseFare: 300, ratePerKm: 10 },
  },
];
const store = createGraphStore(graph, rules);

describe("suggestStations", () => {
  it("駅名で検索でき同一グループは1件に集約される", () => {
    const r = suggestStations(store, "新宿");
    // S1・S3 は同一グループ (G_SHINJUKU) の新宿駅なので代表 1 件のみ返る
    expect(r.length).toBe(1);
    expect(r[0]?.name).toBe("新宿");
  });

  it("候補に座標を含める（選んだ時点で駅を地図に描くため）", () => {
    const [shinjuku] = suggestStations(store, "新宿");
    expect(shinjuku).toMatchObject({ lat: 35.69, lng: 139.7 });
  });
});
