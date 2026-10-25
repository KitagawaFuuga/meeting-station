import { HONSHU_OPERATORS, type FareCalculator } from "@/lib/fare/calculator";
import type { GraphEdge } from "@/lib/graph/types";

// 運賃の状態を1辺ずつ進める処理。探索（lib/search/reachable.ts）と、
// 決まった経路に沿った運賃（lib/search/fare-along-path.ts）の両方から使う。
// 両者で同じ遷移を通すことで、経路に沿って計算した額が探索の額と食い違わないようにする。
export interface FareState {
  stationId: string;
  confirmedFare: number; // 確定済み区間の運賃合計
  segmentOperator: string; // 進行中区間の事業者（"" = 未乗車）
  segmentFromId: string; // 進行中区間の開始駅（特定運賃は区間全体の駅ペアに適用するため必要）
  segmentKm: number; // 進行中区間の距離
  // 運賃計算の発駅。通し運賃の間は JR本州3社に乗り始めた駅、それ以外は segmentFromId。
  // 特定都区市内の規則は通しの発駅で判定するので、会社境界を越えても持ち回る
  fareFromId: string;
  // JR本州3社間の会社境界を1回以上跨いで通算中か。true の間は confirmedFare を
  // 確定させず、基準額＋加算額方式で計算する。
  // honshuThroughKm===0 を代わりに使ってはいけない（距離0のrailエッジで境界を
  // 跨いだ直後は通算中なのに 0 のままになる）。
  isHonshuThrough: boolean;
  honshuThroughKm: number; // 通算中の距離。segmentKm は含まない。非通算中は 0
  honshuThroughEastKm: number; // うち加算額の対象になる距離
  // 進行中区間がすべて地方交通線か（true→falseのみ）。true なら地方交通線の表を
  // 営業キロ（segmentLocalKm）で引く。通し運賃（isHonshuThrough）の間は常に false
  // （通し運賃の地方交通線の扱いは未対応。換算キロで幹線の表を引く近似のまま）
  segmentAllLocal: boolean;
  segmentLocalKm: number; // 進行中区間の営業キロ。segmentAllLocal の間だけ意味を持つ
  fare: number; // confirmedFare + 進行中区間の運賃。状態生成時に確定する
}

// 運賃計算用に整えた辺。km は運賃計算キロ（fareKm ?? km）
export interface AdjacentEdge {
  to: string;
  km: number;
  kind: "rail" | "transfer";
  operator: string;
  // 地方交通線の辺なら営業キロ、そうでなければ undefined
  localKm: number | undefined;
}

export interface FareStepContext {
  calc: FareCalculator;
  nameOf(id: string): string | undefined;
}

// 加算額の対象になる事業者。JR東日本の区間の距離（eastKm）だけが加算額の対象。
// 2026年3月の改定で東京〜熱海の東海道新幹線と在来線は別線になり、在来線経由は
// 加算額がかかる。このアプリは普通列車で行ける範囲を出すので、新幹線経由とみなす
// 除外はしない（docs/search-design.md「2. 加算額（東京〜熱海）」）。
export const EAST_KM_OPERATOR = "JR東日本";

export function segmentEastKmContribution(
  segmentOperator: string,
  segmentKm: number,
): number {
  return segmentOperator === EAST_KM_OPERATOR ? segmentKm : 0;
}

// 進行中区間を「今この駅で降りた場合の運賃」として評価する。
function evaluateSegmentFare(
  calc: FareCalculator,
  segmentOperator: string,
  segmentKm: number,
  isHonshuThrough: boolean,
  honshuThroughKm: number,
  honshuThroughEastKm: number,
  fromName: string | undefined,
  toName: string | undefined,
  localKm: number | undefined,
  fareFromName: string | undefined,
): number {
  if (isHonshuThrough) {
    return calc.estimateHonshuThrough(
      honshuThroughKm + segmentKm,
      honshuThroughEastKm +
        segmentEastKmContribution(segmentOperator, segmentKm),
      fareFromName,
      toName,
    );
  }
  return calc.estimate(segmentOperator, segmentKm, fromName, toName, localKm);
}

// 区間が地方交通線だけのときの営業キロ。そうでなければ undefined（幹線の表で引く）
export const localKmOf = (state: {
  segmentAllLocal: boolean;
  segmentLocalKm: number;
}): number | undefined =>
  state.segmentAllLocal ? state.segmentLocalKm : undefined;

// 探索が扱う距離は運賃計算キロ（fareKm）。営業キロと違う事業者の根拠は
// lib/graph/types.ts の GraphEdge.fareKm 参照。
//
// 地方交通線の辺は「換算キロ（fareKm）が営業キロより長い、地方交通線の表を持つ
// 事業者の辺」で見分ける（換算キロは data/fare-distance-classes.json の地方交通線
// だけに入る）。名鉄の擬制キロなど、表を持たない事業者の fareKm は対象外。
export function toAdjacentEdge(
  calc: FareCalculator,
  e: GraphEdge,
): AdjacentEdge {
  const localKm =
    e.kind === "rail" &&
    e.fareKm !== undefined &&
    e.fareKm > e.km &&
    calc.hasLocalTable(e.operator)
      ? e.km
      : undefined;
  return {
    to: e.to,
    km: e.fareKm ?? e.km,
    kind: e.kind,
    operator: e.operator,
    localKm,
  };
}

export function initialFareState(fromId: string): FareState {
  return {
    stationId: fromId,
    confirmedFare: 0,
    segmentOperator: "",
    segmentFromId: fromId,
    segmentKm: 0,
    fareFromId: fromId,
    isHonshuThrough: false,
    honshuThroughKm: 0,
    honshuThroughEastKm: 0,
    segmentAllLocal: false,
    segmentLocalKm: 0,
    fare: 0,
  };
}

export function advanceFareState(
  ctx: FareStepContext,
  state: FareState,
  edge: AdjacentEdge,
): FareState {
  const { calc, nameOf } = ctx;
  if (edge.kind === "transfer") {
    // stationId だけ差し替えて fare を引き継ぐと、override 判定に使う「現在駅名」
    // が乗り換え前のままになる。必ず再計算する。
    return {
      ...state,
      stationId: edge.to,
      fare:
        state.confirmedFare +
        evaluateSegmentFare(
          calc,
          state.segmentOperator,
          state.segmentKm,
          state.isHonshuThrough,
          state.honshuThroughKm,
          state.honshuThroughEastKm,
          nameOf(state.segmentFromId),
          nameOf(edge.to),
          localKmOf(state),
          nameOf(state.fareFromId),
        ),
    };
  }
  if (edge.operator === state.segmentOperator) {
    const segmentKm = state.segmentKm + edge.km;
    const segmentAllLocal = state.segmentAllLocal && edge.localKm !== undefined;
    const segmentLocalKm = state.segmentLocalKm + (edge.localKm ?? 0);
    return {
      ...state,
      stationId: edge.to,
      segmentKm,
      segmentAllLocal,
      segmentLocalKm,
      fare:
        state.confirmedFare +
        evaluateSegmentFare(
          calc,
          state.segmentOperator,
          segmentKm,
          state.isHonshuThrough,
          state.honshuThroughKm,
          state.honshuThroughEastKm,
          nameOf(state.segmentFromId),
          nameOf(edge.to),
          segmentAllLocal ? segmentLocalKm : undefined,
          nameOf(state.fareFromId),
        ),
    };
  }
  if (
    HONSHU_OPERATORS.has(state.segmentOperator) &&
    HONSHU_OPERATORS.has(edge.operator)
  ) {
    // JR本州3社どうしの会社境界。区間を確定せず通算距離を積み増して継続する
    // （＝ここではまだ運賃を払わない）。state.stationId は直前区間の真の終端。
    const honshuThroughKm = state.honshuThroughKm + state.segmentKm;
    const honshuThroughEastKm =
      state.honshuThroughEastKm +
      segmentEastKmContribution(state.segmentOperator, state.segmentKm);
    const segmentKm = edge.km;
    return {
      stationId: edge.to,
      confirmedFare: state.confirmedFare,
      segmentOperator: edge.operator,
      segmentFromId: state.stationId,
      segmentKm,
      // 非通算中の fareFromId は区間の起点なので、そのまま通しの発駅になる
      fareFromId: state.fareFromId,
      isHonshuThrough: true,
      honshuThroughKm,
      honshuThroughEastKm,
      segmentAllLocal: false,
      segmentLocalKm: 0,
      fare:
        state.confirmedFare +
        calc.estimateHonshuThrough(
          honshuThroughKm + segmentKm,
          honshuThroughEastKm +
            segmentEastKmContribution(edge.operator, segmentKm),
          nameOf(state.fareFromId),
          nameOf(edge.to),
        ),
    };
  }
  // 事業者切り替え。進行中区間をここで確定する。
  const confirmedFare =
    state.confirmedFare +
    evaluateSegmentFare(
      calc,
      state.segmentOperator,
      state.segmentKm,
      state.isHonshuThrough,
      state.honshuThroughKm,
      state.honshuThroughEastKm,
      nameOf(state.segmentFromId),
      nameOf(state.stationId),
      localKmOf(state),
      nameOf(state.fareFromId),
    );
  return {
    stationId: edge.to,
    confirmedFare,
    segmentOperator: edge.operator,
    segmentFromId: state.stationId,
    segmentKm: edge.km,
    fareFromId: state.stationId,
    isHonshuThrough: false,
    honshuThroughKm: 0,
    honshuThroughEastKm: 0,
    segmentAllLocal: edge.localKm !== undefined,
    segmentLocalKm: edge.localKm ?? 0,
    fare:
      confirmedFare +
      calc.estimate(
        edge.operator,
        edge.km,
        nameOf(state.stationId),
        nameOf(edge.to),
        edge.localKm,
      ),
  };
}
