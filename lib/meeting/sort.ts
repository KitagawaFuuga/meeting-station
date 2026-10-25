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
