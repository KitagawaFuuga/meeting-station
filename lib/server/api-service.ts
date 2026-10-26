import Fuse from "fuse.js";
import type { StationNode } from "@/lib/graph/types";
import type { GraphStore } from "@/lib/server/graph-store";

export interface StationSuggestion {
  id: string;
  name: string;
  lineName: string;
  operator: string;
  // 選んだ時点で出発駅を地図に描くのに使う（同じ駅の別路線ノードとは数十mずれ得るが表示には十分）
  lat: number;
  lng: number;
}

// 全駅（約1万件）の曖昧検索インデックスは構築コストが高いので、GraphStore ごとに
// 1度だけ作って使い回す。WeakMap にしているのは、store が破棄されたらインデックスも
// 一緒に回収させるため（テストで store を何度も作り直してもリークしない）。
interface SearchIndex {
  fuse: Fuse<StationNode>;
  // 駅グループごとの乗り入れ路線数（同じ駅の別路線ノードの数）。大きい駅ほど多い
  linesOf: Map<string, number>;
}
const indexCache = new WeakMap<GraphStore, SearchIndex>();

function getIndex(store: GraphStore): SearchIndex {
  let index = indexCache.get(store);
  if (!index) {
    const nodes = Object.values(store.graph.nodes);
    const linesOf = new Map<string, number>();
    for (const n of nodes)
      linesOf.set(n.groupId, (linesOf.get(n.groupId) ?? 0) + 1);
    index = {
      fuse: new Fuse(nodes, {
        keys: ["name"], // 駅名だけを検索対象にする（路線名まで含めるとノイズが増える）
        threshold: 0.3, // 0=完全一致, 1=何でもヒット。打ち間違いは拾いつつ無関係な駅は出さない値
        includeScore: true,
      }),
      linesOf,
    };
    indexCache.set(store, index);
  }
  return index;
}

// 一致度（Fuse の score）をこの幅で丸めて、同じ幅の中では路線数の多い駅を先にする。
// 「東」1文字では「東〜」の駅が何百もほぼ同じ一致度で並び、駅データの並び順（北海道から）の
// まま上位 10 件を取ると東京が入らなかった
const SCORE_BUCKET = 0.1;

// 駅名の曖昧検索。実データでは同じ物理駅が路線ごとに別ノードとして存在する
// （例: 新宿は JR山手線・JR中央線・小田急・京王… で11ノード）ため、そのまま返すと
// 候補が同名駅で埋まる。groupId（同一駅なら同じ値）で重複を除き、1駅1件にする。
export function suggestStations(
  store: GraphStore,
  query: string,
  limit = 10,
): StationSuggestion[] {
  const { fuse, linesOf } = getIndex(store);
  const bucketOf = (score: number | undefined) =>
    Math.round((score ?? 1) / SCORE_BUCKET);
  // 件数を絞らずに全件を取ってから並べ替える。先に絞ると、並べ替えの前に大きい駅が落ちる
  const ranked = fuse
    .search(query)
    .sort(
      (a, b) =>
        bucketOf(a.score) - bucketOf(b.score) ||
        (linesOf.get(b.item.groupId) ?? 0) - (linesOf.get(a.item.groupId) ?? 0),
    );
  const seen = new Set<string>();
  const out: StationSuggestion[] = [];
  for (const { item } of ranked) {
    if (seen.has(item.groupId)) continue;
    seen.add(item.groupId);
    out.push({
      id: item.id,
      name: item.name,
      lineName: item.lineName,
      operator: item.operator,
      lat: item.lat,
      lng: item.lng,
    });
    if (out.length >= limit) break;
  }
  return out;
}
