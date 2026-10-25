import { describe, expect, it } from "vitest";
import type { GraphEdge, RailGraph } from "@/lib/graph/types";
import { buildKmTree, pathEdges } from "@/lib/search/km-tree";

const node = (id: string) => ({
  id,
  groupId: id,
  name: id,
  lat: 35,
  lng: 139,
  lineId: "L",
  lineName: "L",
  operator: "OpA",
});

const rail = (from: string, to: string, km: number): GraphEdge => ({
  from,
  to,
  km,
  kind: "rail",
  operator: "OpA",
});

const graphOf = (ids: string[], edges: GraphEdge[]): RailGraph => ({
  nodes: Object.fromEntries(ids.map((id) => [id, node(id)])),
  edges,
});

describe("buildKmTree", () => {
  it("遠回りの辺より短い直通の辺があるとき、直通の距離になる", () => {
    const g = graphOf(
      ["A", "B", "C"],
      [rail("A", "B", 5), rail("B", "C", 5), rail("A", "C", 7)],
    );
    expect(buildKmTree(g, "A").dist.get("C")).toBe(7);
  });

  it("辺が逆向きに格納されていても、両方向にたどれる", () => {
    const g = graphOf(["A", "B"], [rail("B", "A", 4)]);
    expect(buildKmTree(g, "A").dist.get("B")).toBe(4);
  });

  it("transfer 辺（0km）を挟んでも距離が増えない", () => {
    const g = graphOf(
      ["A", "B", "B2", "C"],
      [
        rail("A", "B", 3),
        { from: "B", to: "B2", km: 0, kind: "transfer", operator: "" },
        rail("B2", "C", 2),
      ],
    );
    expect(buildKmTree(g, "A").dist.get("C")).toBe(5);
  });

  it("つながっていない駅は dist に入らない", () => {
    const g = graphOf(["A", "B", "X"], [rail("A", "B", 1)]);
    expect(buildKmTree(g, "A").dist.has("X")).toBe(false);
  });
});

describe("pathEdges", () => {
  it("root から順に、向きを揃えた辺の列を返す", () => {
    const g = graphOf(["A", "B", "C"], [rail("A", "B", 1), rail("C", "B", 2)]);
    const path = pathEdges(buildKmTree(g, "A"), "C");
    expect(path?.map((e) => [e.from, e.to])).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
  });

  it("届かない駅では null、root では空の列を返す", () => {
    const g = graphOf(["A", "B", "X"], [rail("A", "B", 1)]);
    const tree = buildKmTree(g, "A");
    expect(pathEdges(tree, "X")).toBeNull();
    expect(pathEdges(tree, "A")).toEqual([]);
  });
});
