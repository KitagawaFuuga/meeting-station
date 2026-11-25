import { HONSHU_OPERATORS } from "@/lib/fare/calculator";
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

export interface KmTreeOptions {
  // 事業者が変わる乗換（異なる事業者のノードを結ぶ transfer 辺）に足す距離。
  // 営業キロだけで最短を取ると、関西では JR→Osaka Metro→JR のように細かく乗り継ぎ、
  // 乗るたびに初乗りがかかって通しの運賃が実態の倍になった（京都→神戸で 1770円、最安 870円）。
  // 運賃の精査に使う経路だけこれを指定し、dist は罰則込みの値になる
  operatorChangePenalty?: number;
}

interface Adjacent {
  e: GraphEdge;
  // 事業者が変わる乗換か（罰則の対象）。JR本州3社の会社の境目（熱海・国府津など）は
  // 運賃が通しで続き初乗りがかからないので対象外
  changesFare: boolean;
}

// グラフの辺は片方向だけ格納されているので、両方向に展開した隣接リストを作る。
// 1回の問い合わせで木を6本作るので、グラフごとに1度だけ作って使い回す
// （WeakMap なので、グラフが破棄されれば一緒に回収される）
const adjacencyCache = new WeakMap<RailGraph, Map<string, Adjacent[]>>();

function adjacencyOf(graph: RailGraph): Map<string, Adjacent[]> {
  const cached = adjacencyCache.get(graph);
  if (cached) return cached;
  const changesFare = (e: GraphEdge): boolean => {
    if (e.kind !== "transfer") return false;
    const a = graph.nodes[e.from]?.operator ?? "";
    const b = graph.nodes[e.to]?.operator ?? "";
    return a !== b && !(HONSHU_OPERATORS.has(a) && HONSHU_OPERATORS.has(b));
  };
  const adjacency = new Map<string, Adjacent[]>();
  const add = (e: GraphEdge) => {
    const arr = adjacency.get(e.from) ?? [];
    arr.push({ e, changesFare: changesFare(e) });
    adjacency.set(e.from, arr);
  };
  for (const e of graph.edges) {
    add(e);
    add({ ...e, from: e.to, to: e.from });
  }
  adjacencyCache.set(graph, adjacency);
  return adjacency;
}

export function buildKmTree(
  graph: RailGraph,
  rootId: string,
  options: KmTreeOptions = {},
): KmTree {
  const penalty = options.operatorChangePenalty ?? 0;
  const adjacency = adjacencyOf(graph);

  const dist = new Map<string, number>([[rootId, 0]]);
  const prev = new Map<string, GraphEdge>();
  const heap = new MinHeap<{ id: string; d: number }>((a, b) => a.d - b.d);
  heap.push({ id: rootId, d: 0 });
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === undefined) break;
    if (cur.d > (dist.get(cur.id) ?? Infinity)) continue;
    for (const { e, changesFare } of adjacency.get(cur.id) ?? []) {
      const d = cur.d + e.km + (changesFare ? penalty : 0);
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
