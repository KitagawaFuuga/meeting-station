// 地図の線と印の色。背景の liberty スタイル（水域が青、公園が緑、主要道路が橙〜黄）と
// 色相をずらし、A・B・一緒の区間を見分けられるようにする。表の列と同じ並び
export const ROUTE_COLORS = {
  a: "#b8237a", // Aさん: 赤紫
  b: "#5b3fc4", // Bさん: 青紫
  shared: "#0f4c5c", // 合流してから目的駅まで: 深い青緑（太線）
} as const;
// 候補の駅の円の色は lib/candidate-category.ts（誰が遠回りするかで塗り分ける）
