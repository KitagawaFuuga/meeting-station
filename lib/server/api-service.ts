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
const fuseCache = new WeakMap<GraphStore, Fuse<StationNode>>();

function getFuse(store: GraphStore): Fuse<StationNode> {
  let fuse = fuseCache.get(store);
  if (!fuse) {
    fuse = new Fuse(Object.values(store.graph.nodes), {
      keys: ["name"], // 駅名だけを検索対象にする（路線名まで含めるとノイズが増える）
      threshold: 0.3, // 0=完全一致, 1=何でもヒット。打ち間違いは拾いつつ無関係な駅は出さない値
    });
    fuseCache.set(store, fuse);
  }
  return fuse;
}

// 駅名の曖昧検索。実データでは同じ物理駅が路線ごとに別ノードとして存在する
// （例: 新宿は JR山手線・JR中央線・小田急・京王… で11ノード）ため、そのまま返すと
// 候補が同名駅で埋まる。groupId（同一駅なら同じ値）で重複を除き、1駅1件にする。
export function suggestStations(
  store: GraphStore,
  query: string,
  limit = 10,
): StationSuggestion[] {
  const seen = new Set<string>();
  const out: StationSuggestion[] = [];
  // limit の3倍を要求するのは、重複除去で件数が減るのを見込んだ余裕分
  // （ちょうど limit 件だけ取ると、全部が同一駅の別路線で1件しか残らないことがある）。
  for (const { item } of getFuse(store).search(query, { limit: limit * 3 })) {
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
