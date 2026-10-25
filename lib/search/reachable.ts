import type { FareCalculator } from "@/lib/fare/calculator";
import type { RailGraph } from "@/lib/graph/types";
import {
  advanceFareState,
  EAST_KM_OPERATOR,
  initialFareState,
  localKmOf,
  segmentEastKmContribution,
  toAdjacentEdge,
  type AdjacentEdge,
  type FareState,
  type FareStepContext,
} from "@/lib/search/fare-step";
import { MinHeap } from "@/lib/search/heap";

export interface ReachableStation {
  id: string;
  fare: number;
}

// 状態の各項目の意味は lib/search/fare-step.ts の FareState
interface SearchState extends FareState {
  entry: ParetoEntry; // pop 時の生死判定を O(1) にするための挿入先への参照
  prev: SearchState | null; // 経路の復元用（findCheapestPath）。参照を持つだけで探索の手間は増えない
}

// 枝刈り用ラベル。override があるため「今の運賃が安い方」を残すだけでは正しさを
// 保てず、3次元の非支配集合（Pareto 集合）を保持する。
// 次元の導出は docs/search-design.md「1. Pareto 支配の次元をどう決めたか」。
export interface ParetoEntry {
  confirmedFare: number; // 小さいほうが有利
  totalKm: number; // honshuThroughKm + segmentKm。小さいほうが有利
  totalEastKm: number; // honshuThroughEastKm + セグメントの加算額対象キロ寄与。小さいほうが有利
  fare: number; // 今この駅で降りた場合の運賃
  alive: boolean; // 支配されて bucket から取り除かれたら false
}

// 各次元とも「小さいほうが有利」。距離の向きを逆にすると、同じ路線を往復して
// segmentKm が増え続ける状態が非支配のまま生成され、探索が停止しなくなる。
// 非 strict な <= なので、全次元が等しい場合は既存が勝つ（＝先着優先）。
function dominates(a: ParetoEntry, b: ParetoEntry): boolean {
  return (
    a.confirmedFare <= b.confirmedFare &&
    a.totalKm <= b.totalKm &&
    a.totalEastKm <= b.totalEastKm
  );
}

// SearchState.entry のプレースホルダ。挿入成功後に本物へ差し替える。freeze は
// 万一 bucket や heap に漏れて書き込まれたときに TypeError で気づくため。
const PENDING_ENTRY: ParetoEntry = Object.freeze({
  confirmedFare: 0,
  totalKm: 0,
  totalEastKm: 0,
  fare: 0,
  alive: false,
});

// 既存の import 先を壊さないよう、fare-step.ts へ移した定数をここからも出す
export { EAST_KM_OPERATOR };

// bucket の非支配集合へ挿入する。既存に支配されていれば false を返す。呼び出し側が
// 完全な ParetoEntry を渡すのは、dominates に渡るオブジェクトの形を揃えるため。
export function tryInsertPareto(
  bucket: ParetoEntry[],
  entry: ParetoEntry,
): boolean {
  for (const existing of bucket) {
    if (dominates(existing, entry)) return false;
  }
  for (let i = bucket.length - 1; i >= 0; i--) {
    const existing = bucket[i];
    if (existing !== undefined && dominates(entry, existing)) {
      existing.alive = false;
      bucket.splice(i, 1);
    }
  }
  bucket.push(entry);
  return true;
}

// 4階層のネスト Map でキーを表現する（文字列結合による区切り文字衝突を避けるため）。
// 4階層目のフラグ2種はエッジ緩和のたびに文字列を確保しないよう、4本（2^2）の
// 固定リテラルから選ぶ。
export type __internalParetoStore = Map<
  string,
  Map<string, Map<string, Map<string, ParetoEntry[]>>>
>;
type ParetoStore = __internalParetoStore;

// インデックス = (segmentAllLocal<<1) | isHonshuThrough
//
// segmentAllLocal を bucket に入れるのは、地方交通線だけの状態と幹線を含む状態を
// 距離で比べてはいけないため。前者は営業キロで地方交通線の表、後者は換算キロで
// 幹線の表を引くので、換算キロが長くても前者のほうが安いことがある
// （同じ bucket だと、換算キロの短い幹線経由の状態が安い地方交通線の状態を消す）。
// 地方交通線だけの bucket の中では換算キロ＝営業キロ×1.1（辺ごとに小数3桁で丸め）
// なので、totalKm で比べても営業キロで比べたのと同じ順になる。
const FLAG_KEYS = ["00", "01", "10", "11"] as const;

function flagsKey(isHonshuThrough: boolean, segmentAllLocal: boolean): string {
  const index = (segmentAllLocal ? 2 : 0) | (isHonshuThrough ? 1 : 0);
  const key = FLAG_KEYS[index];
  // FLAG_KEYS は長さ4の固定配列で index は 0-3 の範囲に収まるため必ず存在する。
  if (key === undefined)
    throw new Error(`unreachable: flagsKey index ${index}`);
  return key;
}

function getBucket(
  store: ParetoStore,
  stationId: string,
  segmentOperator: string,
  originBucketKey: string,
  flags: string,
): ParetoEntry[] {
  let byOperator = store.get(stationId);
  if (byOperator === undefined) {
    byOperator = new Map();
    store.set(stationId, byOperator);
  }
  let byFrom = byOperator.get(segmentOperator);
  if (byFrom === undefined) {
    byFrom = new Map();
    byOperator.set(segmentOperator, byFrom);
  }
  let byFlags = byFrom.get(originBucketKey);
  if (byFlags === undefined) {
    byFlags = new Map();
    byFrom.set(originBucketKey, byFlags);
  }
  let bucket = byFlags.get(flags);
  if (bucket === undefined) {
    bucket = [];
    byFlags.set(flags, bucket);
  }
  return bucket;
}

// Pareto 探索の本体。findReachable とテスト用の内部検査の両方から使う。
function runSearch(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
  // 渡されたら、bucket に入った状態をすべて積む（経路の復元用）
  pushed?: SearchState[],
): ParetoStore {
  // 探索が扱う距離は運賃計算キロ（fareKm）。運賃を引くのも枝刈りの次元も距離は
  // ここだけで、外に出すのは運賃だけ（ReachableStation は距離を持たない）なので、
  // 隣接表を作る時点で入れ替えれば足りる（toAdjacentEdge）。
  const adjacency = new Map<string, AdjacentEdge[]>();
  const addAdj = (from: string, edge: AdjacentEdge) => {
    const arr = adjacency.get(from) ?? [];
    arr.push(edge);
    adjacency.set(from, arr);
  };
  for (const e of graph.edges) {
    addAdj(e.from, toAdjacentEdge(calc, e));
    addAdj(e.to, toAdjacentEdge(calc, { ...e, from: e.to, to: e.from }));
  }

  const nameOf = (id: string): string | undefined => graph.nodes[id]?.name;
  const stepCtx: FareStepContext = { calc, nameOf };

  // bucket キーに使う segmentFromId 由来のキー。起点が override の駅ペアに
  // 登場しなければ将来の運賃に影響しないので、まとめて "" に潰してよい
  // （docs/search-design.md「isOverrideAnchor が探索を軽くする理屈」）。
  // 駅名をキーにするのは、同じ物理駅が路線ごとに別ノードIDを持つため。
  // 運賃計算は駅名しか見ないので情報は失われず、bucket 数だけが減る。
  //
  // ただし区間運賃（JR西日本の電車特定区間）の区間内の起点は "" に潰せない。
  // 着駅も区間内なら安い表になるので、同じ距離でも区間外の起点とは将来の運賃が
  // 違う。区間の表は距離だけで決まるので、区間内の起点どうしは区間 id でまとめてよい。
  //
  // 特定都区市内の区域内の発駅（通し運賃ならその発駅）も潰せない。中心駅からの距離に
  // 読み替えるので、同じ距離でも区域外の起点とは将来の運賃が違う。区域内の起点どうしは
  // 区域でまとめる（発駅〜中心駅の違いが効くのは遠回りの経路だけ。近似の範囲は
  // docs/search-design.md「特定都区市内」）。区切りの "|" は駅名・区間 id に現れない。
  const originBucketKey = (
    segmentOperator: string,
    segmentFromId: string,
    fareFromId: string,
    isHonshuThrough: boolean,
    confirmedFare: number,
  ): string => {
    const name = nameOf(segmentFromId);
    let key = "";
    if (name !== undefined) {
      const zone = calc.zoneOf(segmentOperator, name);
      if (calc.isOverrideAnchor(segmentOperator, name)) key = name;
      else if (zone !== undefined) key = `zone:${zone}`;
    }
    const city = calc.specialCityKeyOf(
      segmentOperator,
      nameOf(fareFromId),
      isHonshuThrough,
      budget - confirmedFare,
    );
    if (city === undefined) return key;
    // 辺を緩めるたびに文字列を作らないよう、区域ごとの接尾辞を使い回す
    let suffix = citySuffixes.get(city);
    if (suffix === undefined) {
      suffix = `|city:${city}`;
      citySuffixes.set(city, suffix);
    }
    return key === "" ? suffix : key + suffix;
  };
  const citySuffixes = new Map<string, string>();

  const store: ParetoStore = new Map();
  const initialEntry: ParetoEntry = {
    confirmedFare: 0,
    totalKm: 0,
    totalEastKm: 0,
    fare: 0,
    alive: true,
  };
  tryInsertPareto(
    getBucket(
      store,
      fromId,
      "",
      originBucketKey("", fromId, fromId, false, 0),
      flagsKey(false, false),
    ),
    initialEntry,
  );
  const initial: SearchState = {
    ...initialFareState(fromId),
    entry: initialEntry,
    prev: null,
  };
  pushed?.push(initial);
  const heap = new MinHeap<SearchState>((a, b) => a.fare - b.fare);
  heap.push(initial);

  while (heap.size > 0) {
    const state = heap.pop();
    if (state === undefined) break;

    // pop 時点で他状態に支配されて取り除かれていないか。参照を持っているので O(1)。
    if (!state.entry.alive) continue;

    for (const edge of adjacency.get(state.stationId) ?? []) {
      const next: SearchState = {
        ...advanceFareState(stepCtx, state, edge),
        entry: PENDING_ENTRY,
        prev: state,
      };
      // next.fare は override により非単調なので、これで刈ると「区間の途中は予算超過
      // だが override で安くなる終点」を取りこぼす。代わりに confirmedFare（経路に
      // 沿って非減少）に区間の下界を足した値で刈る。
      // 停止性の根拠は docs/search-design.md「3. 探索の停止性」。
      const segmentLowerBound = next.isHonshuThrough
        ? calc.honshuThroughBaseFare(
            next.honshuThroughKm + next.segmentKm,
            nameOf(next.fareFromId),
          )
        : calc.lowerBound(
            next.segmentOperator,
            next.segmentKm,
            nameOf(next.segmentFromId),
            localKmOf(next),
          );
      if (next.confirmedFare + segmentLowerBound > budget) continue;

      const nextBucket = getBucket(
        store,
        next.stationId,
        next.segmentOperator,
        originBucketKey(
          next.segmentOperator,
          next.segmentFromId,
          next.fareFromId,
          next.isHonshuThrough,
          next.confirmedFare,
        ),
        flagsKey(next.isHonshuThrough, next.segmentAllLocal),
      );
      const nextEntry: ParetoEntry = {
        confirmedFare: next.confirmedFare,
        totalKm: next.honshuThroughKm + next.segmentKm,
        totalEastKm:
          next.honshuThroughEastKm +
          segmentEastKmContribution(next.segmentOperator, next.segmentKm),
        fare: next.fare,
        alive: true,
      };
      const inserted = tryInsertPareto(nextBucket, nextEntry);
      if (inserted) {
        next.entry = nextEntry;
        heap.push(next);
        pushed?.push(next);
      }
    }
  }

  return store;
}

// fromId から toGroupId に属するいずれかのノードに着く最安の状態の経路。
// 同じ運賃なら運賃計算キロの短いほう。予算内に無ければ null
export function findCheapestPath(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  toGroupId: string,
  budget: number,
): { fare: number; nodeIds: string[] } | null {
  const pushed: SearchState[] = [];
  runSearch(graph, calc, fromId, budget, pushed);

  let best: SearchState | undefined;
  for (const s of pushed) {
    // 支配されて bucket から外れた状態は、より安いか同じ状態に置き換わっている
    if (!s.entry.alive || s.fare > budget) continue;
    if (graph.nodes[s.stationId]?.groupId !== toGroupId) continue;
    if (
      !best ||
      s.fare < best.fare ||
      (s.fare === best.fare && s.entry.totalKm < best.entry.totalKm)
    ) {
      best = s;
    }
  }
  if (!best) return null;

  const nodeIds: string[] = [];
  for (let s: SearchState | null = best; s; s = s.prev)
    nodeIds.push(s.stationId);
  return { fare: best.fare, nodeIds: nodeIds.reverse() };
}

export function findReachable(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
): ReachableStation[] {
  const store = runSearch(graph, calc, fromId, budget);

  // 同じ駅に複数の状態（由来違い）が残りうるので、駅ごとに最安値へ集約する。
  // budget によるフィルタはここで行う（探索中の fare は非単調なため）。
  const byStation = new Map<string, number>();
  for (const [stationId, byOperator] of store) {
    for (const byFrom of byOperator.values()) {
      for (const byFlags of byFrom.values()) {
        for (const bucket of byFlags.values()) {
          for (const entry of bucket) {
            if (entry.fare > budget) continue;
            if (entry.fare < (byStation.get(stationId) ?? Infinity)) {
              byStation.set(stationId, entry.fare);
            }
          }
        }
      }
    }
  }

  return [...byStation.entries()]
    .map(([id, fare]) => ({ id, fare }))
    .sort((a, b) => a.fare - b.fare);
}

// テスト専用。bucket を直接検査するために ParetoStore をそのまま返す。
// アプリケーションコードから呼んではいけない。
export function __internalRunSearchForTest(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
): ParetoStore {
  return runSearch(graph, calc, fromId, budget);
}
