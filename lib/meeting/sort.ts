import type { Candidate } from "@/lib/meeting/types";

export type SortOrder = "detour" | "together";

const total = (c: Candidate) => c.detourA + c.detourB;
// 片方だけが損をする候補を下げるための、二人の遠回りの差
const gap = (c: Candidate) => Math.abs(c.detourA - c.detourB);

// 並べ方の細部は設計書 4章「並べ方の細部」。新しい配列を返す
export function sortCandidates(
  list: Candidate[],
  order: SortOrder,
): Candidate[] {
  const compare =
    order === "detour"
      ? (a: Candidate, b: Candidate) =>
          total(a) - total(b) || gap(a) - gap(b) || b.shared - a.shared
      : (a: Candidate, b: Candidate) =>
          b.shared - a.shared || total(a) - total(b);
  // 現地集合（目的駅）は合流しない選択肢なので、どちらの並べ方でも最後に置く
  return [...list].sort(
    (a, b) =>
      Number(a.isDestination) - Number(b.isDestination) || compare(a, b),
  );
}

// 長距離では候補が数千件になり、計算も応答も表も重くなる。どちらの並べ方で
// 見ても上位 n 件に入る候補と、目的駅（現地集合）だけを残す。順序は保証しない
export function limitCandidates(list: Candidate[], n: number): Candidate[] {
  const kept = new Set<Candidate>(list.filter((c) => c.isDestination));
  for (const order of ["detour", "together"] as const) {
    for (const c of sortCandidates(list, order).slice(0, n)) kept.add(c);
  }
  return [...kept];
}
