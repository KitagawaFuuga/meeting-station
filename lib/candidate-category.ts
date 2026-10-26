import type { Candidate } from "@/lib/meeting/types";
import { ROUTE_COLORS } from "@/lib/route-colors";

// 地図の候補の円を、誰が遠回りするかで塗り分ける。A・B の色は地図の経路の線と同じなので、
// 「この駅だと A さんが損をする」が色で読める。二人とも遠回りする駅は目立たせない灰色
export type DetourCategory = "none" | "a" | "b" | "both";

export const CATEGORY_COLORS: Record<DetourCategory, string> = {
  none: "#15803d", // 二人とも遠回りなし: 緑（公園の淡い緑より濃く、陸に 4.6:1）
  a: ROUTE_COLORS.a,
  b: ROUTE_COLORS.b,
  both: "#8a8f98", // 二人とも遠回り: 灰（陸に 3.0:1）
};

// 凡例の文言。並びは凡例に出す順
export const CATEGORY_LABELS: [DetourCategory, string][] = [
  ["none", "二人とも遠回りなし"],
  ["a", "Aさんだけ遠回り"],
  ["b", "Bさんだけ遠回り"],
  ["both", "二人とも遠回り"],
];

// 番号つきの大きな印で目立たせる、表の上位の件数
export const TOP_PICKS = 5;

// これ未満の遠回りは無いものとみなす。表は距離を小数1桁（0.05km 未満は 0.0km）で出すので、
// それと色を合わせる。運賃は整数の円なので影響しない
const NEGLIGIBLE = 0.05;

export function detourCategory(c: Candidate): DetourCategory {
  const a = c.detourA >= NEGLIGIBLE;
  const b = c.detourB >= NEGLIGIBLE;
  if (a && b) return "both";
  if (a) return "a";
  if (b) return "b";
  return "none";
}
