import type { GraphEdge } from "@/lib/graph/types";
import {
  UnreachableError,
  type Candidate,
  type MeetingResult,
} from "@/lib/meeting/types";
import { fareAlongPath } from "@/lib/search/fare-along-path";
import { buildKmTree, pathEdges } from "@/lib/search/km-tree";
import { findCheapestPath } from "@/lib/search/reachable";
import type { GraphStore } from "@/lib/server/graph-store";

// 遠回りが「直接行く量の半分以内」の駅だけを候補にする（設計書 4章「候補の母集団」）
const DETOUR_LIMIT = 0.5;
// 運賃で精査する駅を距離でふるう網目。運賃と距離の比率は事業者ごとに違うので、
// 距離の上限（半分）より広くとる
const FARE_PREFILTER_LIMIT = 1.0;
// 営業キロの足し算で出る 1e-12 程度の誤差で、境界の駅を落とさないための余裕
const EPS = 1e-9;
// 運賃の精査に使う経路で、事業者が変わる乗換1回に足す距離（km-tree.ts の operatorChangePenalty）。
// 初乗り1回分（概ね 10km の運賃）より重くして、近道のための乗り継ぎを避けさせる
export const FARE_PATH_OPERATOR_PENALTY_KM = 15;

// 目的駅を根にした木の経路（目的駅→M）を、M→目的駅 の向きに直す
function reversed(edges: GraphEdge[]): GraphEdge[] {
  return edges.map((e) => ({ ...e, from: e.to, to: e.from })).reverse();
}

// 合流駅の候補を出す。並べ替えはしない（lib/meeting/sort.ts）。
// 経由点の手法にならい、A・B・目的駅の3点から最短経路木を作り、
// 全駅の「その駅を経由したときの距離」を足し算で出す（ふるい分け）。
// 料金は、残った駅だけ通しの運賃で精査する（設計書 4章）。
export function findMeetingCandidates(
  store: GraphStore,
  aId: string,
  bId: string,
  toId: string,
): MeetingResult {
  const { graph, calc } = store;
  const toGroup = graph.nodes[toId]?.groupId;
  const tA = buildKmTree(graph, aId);
  const tB = buildKmTree(graph, bId);
  const tD = buildKmTree(graph, toId);
  const dAD = tA.dist.get(toId);
  const dBD = tB.dist.get(toId);
  if (dAD === undefined || dBD === undefined) {
    throw new UnreachableError("線路でつながっていません");
  }

  // 料金の精査は、事業者が変わる乗換に罰則を足した経路で行う（ふるい分けは本物の営業キロ）
  const fareTree = (rootId: string) =>
    buildKmTree(graph, rootId, {
      operatorChangePenalty: FARE_PATH_OPERATOR_PENALTY_KM,
    });
  const fD = fareTree(toId);

  // 料金の精査に使う、出発駅ごとの最安運賃と最安経路上の駅グループ
  const fareSide = (rootId: string) => {
    const tree = fareTree(rootId);
    const direct = pathEdges(tree, toId) ?? [];
    // 最安運賃はこの経路の運賃以下なので、予算にすれば取りこぼさずに探索を絞れる
    const budget = fareAlongPath(graph, calc, rootId, direct);
    const cheapest = toGroup
      ? findCheapestPath(graph, calc, rootId, toGroup, budget)
      : null;
    const onCheapest = new Set(
      (cheapest?.nodeIds ?? []).map((id) => graph.nodes[id]?.groupId),
    );
    const cheapestFare = cheapest?.fare ?? budget;
    const via = (mId: string, toDest: GraphEdge[]): number => {
      if (onCheapest.has(graph.nodes[mId]?.groupId)) return cheapestFare;
      const toM = pathEdges(tree, mId) ?? [];
      return fareAlongPath(graph, calc, rootId, [...toM, ...toDest]);
    };
    // 探索が予算内に着けなかったとき（通常は起きない）は、予算にした経路を最安とみなす
    const path = cheapest?.nodeIds ?? [rootId, ...direct.map((e) => e.to)];
    return { cheapestFare, via, path };
  };
  const fareA = fareSide(aId);
  const fareB = fareSide(bId);

  // 同じ駅の別路線ノードは1候補にまとめる。代表は二人の経由距離の合計が最小のノード
  const reps = new Map<string, { id: string; score: number }>();
  for (const [id, dD] of tD.dist) {
    const dA = tA.dist.get(id);
    const dB = tB.dist.get(id);
    const g = graph.nodes[id]?.groupId;
    if (dA === undefined || dB === undefined || g === undefined) continue;
    const score = dA + dB + 2 * dD;
    if (score < (reps.get(g)?.score ?? Infinity)) reps.set(g, { id, score });
  }

  const km: Candidate[] = [];
  const fare: Candidate[] = [];
  for (const { id } of reps.values()) {
    const dA = tA.dist.get(id);
    const dB = tB.dist.get(id);
    const dD = tD.dist.get(id);
    const n = graph.nodes[id];
    if (dA === undefined || dB === undefined || dD === undefined || !n)
      continue;
    const kmDetourA = Math.max(0, dA + dD - dAD);
    const kmDetourB = Math.max(0, dB + dD - dBD);
    const base = {
      groupId: n.groupId,
      stationId: n.id,
      name: n.name,
      lat: n.lat,
      lng: n.lng,
      line: n.lineName,
      operator: n.operator,
      isDestination: n.groupId === toGroup,
    };
    if (
      kmDetourA <= dAD * DETOUR_LIMIT + EPS &&
      kmDetourB <= dBD * DETOUR_LIMIT + EPS
    ) {
      km.push({ ...base, detourA: kmDetourA, detourB: kmDetourB, shared: dD });
    }

    if (
      kmDetourA > dAD * FARE_PREFILTER_LIMIT + EPS ||
      kmDetourB > dBD * FARE_PREFILTER_LIMIT + EPS
    )
      continue;
    const toDest = reversed(pathEdges(fD, id) ?? []);
    const detourA = Math.max(0, fareA.via(id, toDest) - fareA.cheapestFare);
    const detourB = Math.max(0, fareB.via(id, toDest) - fareB.cheapestFare);
    if (
      detourA > fareA.cheapestFare * DETOUR_LIMIT ||
      detourB > fareB.cheapestFare * DETOUR_LIMIT
    )
      continue;
    fare.push({
      ...base,
      detourA,
      detourB,
      shared: fareAlongPath(graph, calc, id, toDest),
    });
  }
  return { fare, km, cheapest: { a: fareA.path, b: fareB.path } };
}
