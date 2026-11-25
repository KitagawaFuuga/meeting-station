import {
  FARE_PATH_OPERATOR_PENALTY_KM,
  findMeetingCandidates,
} from "@/lib/meeting/candidates";
import type { CheapestPaths, MeetingResult, Metric } from "@/lib/meeting/types";
import { buildKmTree, pathEdges } from "@/lib/search/km-tree";
import type { GraphStore } from "@/lib/server/graph-store";
import { createResultCache } from "@/lib/server/result-cache";

export interface Trip {
  a: string;
  b: string;
  to: string;
}

export interface PathQuery extends Trip {
  via: string;
  metric: Metric;
}

// 座標は [lng, lat]（MapLibre・GeoJSON の順）
export interface PathResult {
  legs: {
    a: [number, number][];
    b: [number, number][];
    shared: [number, number][];
  };
}

// 選んだ候補で落ち合うときの二人の経路。A→via、B→via、via→目的駅 の3区間。
// 料金の物差しでは、候補の運賃を精査したのと同じ経路を描く（lib/meeting/candidates.ts）。
// cheapest は A・B それぞれの目的駅までの最安経路（駅 id の並び）。距離の物差しでは使わない
export function meetingPath(
  store: GraphStore,
  q: PathQuery,
  cheapest: CheapestPaths = { a: [], b: [] },
): PathResult {
  const { graph } = store;
  const groupOf = (id: string) => graph.nodes[id]?.groupId;
  const coords = (ids: string[]): [number, number][] =>
    ids.flatMap((id) => {
      const n = graph.nodes[id];
      return n ? [[n.lng, n.lat] as [number, number]] : [];
    });
  const options =
    q.metric === "fare"
      ? { operatorChangePenalty: FARE_PATH_OPERATOR_PENALTY_KM }
      : {};
  const nodesTo = (rootId: string, toId: string): string[] => {
    const edges = pathEdges(buildKmTree(graph, rootId, options), toId) ?? [];
    return [rootId, ...edges.map((e) => e.to)];
  };
  // 最安経路のうち via の駅グループが現れる位置。無ければ -1
  const viaIndex = (path: string[]) =>
    q.metric === "fare"
      ? path.findIndex((id) => groupOf(id) === groupOf(q.via))
      : -1;
  const iA = viaIndex(cheapest.a);
  const iB = viaIndex(cheapest.b);
  const leg = (rootId: string, path: string[], i: number) =>
    i >= 0 ? path.slice(0, i + 1) : nodesTo(rootId, q.via);
  const shared =
    iA >= 0
      ? cheapest.a.slice(iA)
      : iB >= 0
        ? cheapest.b.slice(iB)
        : nodesTo(q.to, q.via).reverse();
  return {
    legs: {
      a: coords(leg(q.a, cheapest.a, iA)),
      b: coords(leg(q.b, cheapest.b, iB)),
      shared: coords(shared),
    },
  };
}

// 3駅の組ごとの候補の結果。graph-store と同じく、Next.js のサーバープロセスが
// 生きている間だけ保持される揮発状態（min-replicas 0 / 単一インスタンスの構成が前提）
export function createMeetingService(cacheEntries: number) {
  const cache = createResultCache<MeetingResult>(cacheEntries);
  return {
    // findMeetingCandidates の UnreachableError はそのまま投げる
    candidates(store: GraphStore, trip: Trip): MeetingResult {
      const key = `${trip.a}|${trip.b}|${trip.to}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const result = findMeetingCandidates(store, trip.a, trip.b, trip.to);
      cache.set(key, result);
      return result;
    },
  };
}
