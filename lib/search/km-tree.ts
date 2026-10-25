import type { GraphEdge, RailGraph } from "@/lib/graph/types";
import { MinHeap } from "@/lib/search/heap";

// 営業キロの最短経路木。合流駅の候補を距離でふるい分けるのに使う
// （運賃の探索より桁違いに軽いので、全駅への距離をまとめて出せる）。
// 距離は営業キロ（GraphEdge.km）。運賃計算キロ（fareKm）は運賃の中だけで使う。
export interface KmTree {
  rootId: string;
  dist: Map<string, number>; // 届かない駅は入らない
  prev: Map<string, GraphEdge>; // その駅に入った辺。向きは「親 → 子」に揃えたコピー
}

export function buildKmTree(graph: RailGraph, rootId: string): KmTree {
  // グラフの辺は片方向だけ格納されているので、両方向に展開する
  const adjacency = new Map<string, GraphEdge[]>();
  const add = (e: GraphEdge) => {
    const arr = adjacency.get(e.from) ?? [];
    arr.push(e);
    adjacency.set(e.from, arr);
  };
  for (const e of graph.edges) {
    add(e);
    add({ ...e, from: e.to, to: e.from });
  }

  const dist = new Map<string, number>([[rootId, 0]]);
  const prev = new Map<string, GraphEdge>();
  const heap = new MinHeap<{ id: string; d: number }>((a, b) => a.d - b.d);
  heap.push({ id: rootId, d: 0 });
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === undefined) break;
    if (cur.d > (dist.get(cur.id) ?? Infinity)) continue;
    for (const e of adjacency.get(cur.id) ?? []) {
      const d = cur.d + e.km;
      if (d < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, d);
        prev.set(e.to, e);
        heap.push({ id: e.to, d });
      }
    }
  }
  return { rootId, dist, prev };
}

// root から toId までの辺の列（root→toId の向き）。toId === root なら []、届かなければ null
export function pathEdges(tree: KmTree, toId: string): GraphEdge[] | null {
  if (!tree.dist.has(toId)) return null;
  const edges: GraphEdge[] = [];
  let cur = toId;
  while (cur !== tree.rootId) {
    const e = tree.prev.get(cur);
    if (!e) return null;
    edges.push(e);
    cur = e.from;
  }
  return edges.reverse();
}
