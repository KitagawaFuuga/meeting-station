// 地図の候補の円の色。表の並び順で上位ほど濃く、下位ほど淡い1色相（青緑）の5段階。
// 順序のある量は虹色にせず1色相の濃淡で塗る（fare-map と同じ考え方）。背景の liberty の
// 水域（青）・公園（緑）・道路（橙〜黄）と見分けられ、いちばん淡い段階でも陸に対して
// 2.3:1 のコントラストを保つ。濃い側は黒に見えないよう明るめにした（#0b3d4a 始まりだと
// 全部ほぼ黒に見えると言われた）
export const CANDIDATE_SHADES = [
  "#0e7c86",
  "#1f8e95",
  "#35a0a3",
  "#44a9aa",
  "#52b1b0",
] as const;

// 番号つきの大きな印で目立たせる、表の上位の件数
export const TOP_PICKS = 5;

// 表で rank 番目（0 始まり）の候補が何段階目の色か。値ではなく順位で決めるので、
// 並べ方を切り替えると濃淡も表の順に入れ替わる
export function shadeIndex(rank: number, total: number): number {
  const last = CANDIDATE_SHADES.length - 1;
  return Math.min(last, Math.floor((rank * CANDIDATE_SHADES.length) / total));
}
