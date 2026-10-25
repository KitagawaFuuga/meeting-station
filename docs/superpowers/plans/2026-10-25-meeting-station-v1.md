# 合流駅さがし v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3駅（A・B・目的駅）を入れると、合流駅の候補を地図と比較表で出し、物差し（料金／距離）と並べ方（遠回りが少ない順／長く一緒の順）を切り替えられるアプリを、fare-map を土台に作る。

**Architecture:** fare-map のリポジトリを丸ごと取り込み、駅データ・運賃計算・地図・公開の仕組みを流用する。探索は2段構え。営業キロの最短経路木を3本（A・B・目的駅）作って候補をふるい分け、残った候補だけ「経路に沿った通しの運賃」で精査する。サーバーは候補一覧の API と、選んだ候補の経路の API を返す。画面は fare-map と同じ「左パネル／ボトムシート＋地図」構成。

**Tech Stack:** Next.js 16（App Router、standalone）/ TypeScript strict / React 19 / Tailwind 4 / MapLibre GL 6 + OpenFreeMap / zod 4 / fuse.js / Vitest 5 / Playwright / Azure Container Apps / Docker Hub / GitHub Actions

**Spec:** `docs/superpowers/specs/2026-10-25-meeting-station-design.md`（fare-map の `docs/reuse-guide.md` も参照）

## Global Constraints

- 候補の母集団: A・B それぞれの遠回りが、その人が目的駅まで直接行く量の**半分以内**（`<= direct * 0.5`）。物差しが料金なら運賃で、距離なら営業キロで判定する
- 遠回り ＝（M 経由の量）−（直接の量）。負なら 0
- 料金の M 経由の量: M が A→目的駅 の最安経路上なら最安運賃。そうでなければ、営業キロ最短の A→M と M→目的駅 をつないだ経路に沿った運賃（`fareAlongPath`）
- 料金の直接の量は、fare-map の探索で出した最安運賃
- 運賃探索の予算は「営業キロ最短の A→目的駅 に沿った運賃」
- 距離は営業キロ（`GraphEdge.km`）。運賃計算キロ（`fareKm`）は運賃計算の中だけで使う
- 並べ方「遠回りが少ない順」: 遠回りの合計の昇順 → 二人の差の昇順 → 一緒に乗る区間の降順
- 並べ方「長く一緒に乗れる順」: 一緒に乗る区間の降順 → 遠回りの合計の昇順
- 目的駅（現地集合）は、どちらの並べ方でも常に最後に置く
- 候補は駅グループ（`groupId`）単位。駅名では束ねない（同名の別駅がある）
- 応答時間の目標: 1回の問い合わせで 2 秒以内（本番 0.5 vCPU）
- 3人以上の合流、所要時間、遠回りの上限入力、乗換案内は作らない
- 入力欄は文の形「〇〇 と △△ から □□ へ」
- `lib/` `app/` `components/` は Probity が TDD を強制する。テストは1回の編集で1件ずつ足す。Edit・Write ツールで書く（Bash で書き換えない）。テストと import は同じ編集に入れる
- Next.js 16 の API を使う前に `node_modules/next/dist/docs/` の該当ガイドを読む（AGENTS.md）
- テスト名は日本語で「何を・どういう条件で・どうなるか」
- コミットは Conventional Commits、1コミット＝1論理変更、`console.log` を残さない

## Review Focus

1. **同じ駅の別路線ノード**（新宿の JR と小田急など）: 同じ groupId のノードは1候補にまとまり、A がその駅から出るなら A の遠回りは 0。Task 6 のテストで固定する
2. **A と B が同じ駅**: 経路上の候補は二人とも遠回り 0 で並ぶ。Task 6 のテストで固定する
3. **目的駅が A か B と同じ**（同じ groupId）: 400 で「出発駅と目的駅が同じです」。Task 8 のテストで固定する
4. **線路がつながっていない組**（ゆいレールの駅→東京）: 500 にせず 422 で「線路でつながっていません」。Task 6 と Task 8 のテストで固定する
5. **通しの運賃が直接の最安額より安く出る**（JR 通算の端数など）: 遠回りは負にせず 0。Task 6 のテストで固定する

---

### Task 1: fare-map の土台を取り込む

**Files:**
- Create: fare-map の HEAD 一式（`git archive` で展開）。`lib/` `app/` `components/` は**一字も変えない**（fare-map のアプリがそのまま動く状態で取り込む）
- Modify（Probity の対象外のファイルだけ）: `package.json`（`name` を `meeting-station`）、`.github/workflows/deploy.yml`（`fare-map` → `meeting-station`、`fare-map-rg` → `meeting-station-rg`）、`README.md`（冒頭のアプリ名と説明だけ。出典節は残す）、`e2e/smoke.spec.ts` の `stubTiles` と `EMPTY_STYLE` を `e2e/helpers.ts` へ移して import する

このタスクは、テスト済みのコードをテストごとそのまま写す取り込みである。新しい振る舞いは足さない。
fare-map 固有の画面・API（`BudgetInput`・`StationList`・`hooks/use-reachable.ts`・`app/api/reachable/`・`app/api/route-url/`・`lib/budget.ts`・`lib/brackets.ts`・`lib/server/route-url.ts`・`e2e/boundary.spec.ts`）は、置き換える Task 9・10 で使われなくなった時点で、そのテストごと消す。

- [ ] **Step 1: 取り込む**

```bash
cd /c/Users/fuuga/source/repos/meeting-station
git -C ../fare-map archive HEAD | tar -x --skip-old-files -f -
cp -r ../fare-map/data/raw data/raw   # .gitignore 済み。生データ照合テストと pipeline 用
```

`--skip-old-files` で、既存の `.gitignore`・`docs/superpowers/` は上書きしない。取り込み後に fare-map の `.gitignore` の行（`data/raw/`、`public/maplibre-gl-*.mjs`、Playwright の出力先）を手元の `.gitignore` に足す。

- [ ] **Step 2: 上の Modify を当てる**

- [ ] **Step 3: 検証**

Run: `npm ci && npm run lint && npm run format:check && npm run typecheck && npm test`
Expected: すべて成功（テスト件数は fare-map と同じ）

- [ ] **Step 4: Commit**

```bash
git add -A && git status   # 認証情報・data/raw が入っていないことを確かめる
git commit -m "chore: fare-map から駅データ・運賃計算・地図・公開の土台を取り込む"
```

---

### Task 2: 既知の課題を直す（IP の取り方・ワークフローの権限）

**Files:**
- Create: `lib/server/client-ip.ts`
- Test: `lib/server/__tests__/client-ip.test.ts`
- Modify: `.github/workflows/ci.yml`、`.github/workflows/deploy.yml`

**Interfaces:**
- Produces: `clientIp(headers: Headers): string`

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("x-forwarded-for が複数あるとき、利用者が書き換えられない末尾の値を使う", () => {
  const h = new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
  expect(clientIp(h)).toBe("203.0.113.9");
});
```

続けて1件ずつ: 「1件だけならその値」、「無ければ x-real-ip」、「どちらも無ければ "unknown"」。

- [ ] **Step 2: 赤を確認** — Run: `npx vitest run lib/server/__tests__/client-ip.test.ts` / Expected: FAIL（モジュールが無い）

- [ ] **Step 3: `clientIp(headers: Headers): string` を実装** — Azure Container Apps の前段（Envoy）は接続元の IP を末尾に足す。先頭は利用者が自由に書けるので使わない、とコメントに残す

- [ ] **Step 4: 緑を確認** — 同じコマンドで PASS

- [ ] **Step 5: ワークフローの各ジョブに `permissions: contents: read` を足す**（deploy の push ジョブで書き込みが要るものは除く）

- [ ] **Step 6: Commit** — `fix: レート制限の IP を x-forwarded-for の末尾から取る` と `ci: ワークフローの権限を読み取りに絞る` の2コミット

---

### Task 3: 営業キロの最短経路木

**Files:**
- Create: `lib/search/km-tree.ts`
- Test: `lib/search/__tests__/km-tree.test.ts`

**Interfaces:**
- Consumes: `RailGraph`、`GraphEdge`（`lib/graph/types.ts`）、`MinHeap`（`lib/search/heap.ts`）
- Produces:

```ts
export interface KmTree {
  rootId: string;
  dist: Map<string, number>;        // 営業キロ。届かない駅は入らない
  prev: Map<string, GraphEdge>;     // その駅に入った辺。向きは「親 → 子」に揃えたコピー
}
export function buildKmTree(graph: RailGraph, rootId: string): KmTree;
// root から toId までの辺の列（root→toId の向き）。toId === root なら []、届かなければ null
export function pathEdges(tree: KmTree, toId: string): GraphEdge[] | null;
```

- [ ] **Step 1: 失敗するテストを書く**（小さなグラフをテスト内で組む。`lib/search/__tests__/reachable.test.ts` の `node()` と同じ書き方）

```ts
it("遠回りの辺より短い直通の辺があるとき、直通の距離になる", () => {
  // A-B 5km, B-C 5km, A-C 7km
  expect(buildKmTree(g, "A").dist.get("C")).toBe(7);
});
```

続けて1件ずつ: 「transfer 辺（0km）を挟んでも距離が増えない」、「辺は無向として両方向にたどる」、「つながっていない駅は dist に入らない」、「pathEdges は root から順に向きを揃えて返す」、「pathEdges は届かない駅で null、root で []」。

- [ ] **Step 2〜4: 赤 → `buildKmTree`・`pathEdges` を実装（ダイクストラ、`MinHeap` を使う）→ 緑** — Run: `npx vitest run lib/search/__tests__/km-tree.test.ts`

- [ ] **Step 5: Commit** — `feat: 営業キロの最短経路木を作る`

---

### Task 4: 決まった経路に沿った通しの運賃

**Files:**
- Modify: `lib/search/reachable.ts`（`runSearch` のループ内の「状態を1辺進める」処理を関数に切り出す）
- Create: `lib/search/fare-step.ts`、`lib/search/fare-along-path.ts`
- Test: `lib/search/__tests__/fare-along-path.test.ts`

**Interfaces:**
- Consumes: `GraphEdge`、`FareCalculator`、`pathEdges` の戻り値
- Produces:

```ts
// fare-step.ts。runSearch の SearchState から entry を除いたもの
export interface FareState { /* stationId, confirmedFare, segmentOperator, segmentFromId, segmentKm, fareFromId, isHonshuThrough, honshuThroughKm, honshuThroughEastKm, segmentAllLocal, segmentLocalKm, fare */ }
export interface FareStepContext { calc: FareCalculator; nameOf(id: string): string | undefined }
// runSearch の隣接表の要素を型として外に出したもの
export interface AdjacentEdge { to: string; km: number; kind: "rail" | "transfer"; operator: string; localKm: number | undefined }
export function initialFareState(fromId: string): FareState;
// edge は runSearch の隣接表と同じ形（km は fareKm ?? km、localKm 判定済み）
export function advanceFareState(ctx: FareStepContext, state: FareState, edge: AdjacentEdge): FareState;
export function toAdjacentEdge(calc: FareCalculator, e: GraphEdge): AdjacentEdge;

// fare-along-path.ts。edges は連続していること（edges[i].to === edges[i+1].from）。空なら 0
export function fareAlongPath(graph: RailGraph, calc: FareCalculator, fromId: string, edges: GraphEdge[]): number;
```

- [ ] **Step 1: 既存テストが緑であることを確認** — Run: `npm test` / Expected: PASS（切り出しの前後で同じ件数が緑のままであることが、振る舞いを変えていない証拠になる）

- [ ] **Step 2: `fare-along-path.test.ts` に失敗するテストを書く**

```ts
it("1事業者だけの経路では、その距離の運賃表の額になる", () => {
  expect(fareAlongPath(graph, calc, "a1", edges)).toBe(calc.estimate("OpA", 12));
});
```

続けて1件ずつ: 「事業者が切り替わると、区間ごとの運賃の合計になる」、「JR本州3社の会社境界をまたぐと通算した運賃になる（findReachable がその駅に出す額と同じ）」、「空の経路は 0」。3件目は `reachable.test.ts` の通算のフィクスチャを使い、`findReachable` の結果と突き合わせる。

- [ ] **Step 3: 赤を確認** — Run: `npx vitest run lib/search/__tests__/fare-along-path.test.ts` / Expected: FAIL

- [ ] **Step 4: `runSearch` の4分岐（transfer／同じ事業者／JR本州の境界／事業者の切り替え）を `advanceFareState` に移し、`runSearch` はそれを呼ぶ形にする。`fareAlongPath` は `initialFareState` から辺ごとに `advanceFareState` を畳み込み、最後の `fare` を返す**

- [ ] **Step 5: 緑を確認** — Run: `npm test` / Expected: 既存も新規もすべて PASS

- [ ] **Step 6: Commit** — `refactor: 運賃の状態を1辺進める処理を探索から切り出す` と `feat: 決まった経路に沿った通しの運賃を計算する` の2コミット

---

### Task 5: 最安経路の復元

**Files:**
- Modify: `lib/search/reachable.ts`
- Test: `lib/search/__tests__/cheapest-path.test.ts`

**Interfaces:**
- Produces:

```ts
// toGroupId に属するいずれかのノードに着く最安の状態の経路。予算内に無ければ null
export function findCheapestPath(
  graph: RailGraph, calc: FareCalculator, fromId: string, toGroupId: string, budget: number,
): { fare: number; nodeIds: string[] } | null;
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("営業キロでは遠回りでも安い経路があるとき、その経路の駅の並びを返す", () => {
  const r = findCheapestPath(graph, calc, "s", "g-goal", 1000);
  expect(r?.nodeIds).toEqual(["s", "p1", "p2", "goal"]);
});
```

続けて1件ずつ: 「fare は findReachable がその駅に出す額と同じ」、「予算内に着けなければ null」。

- [ ] **Step 2: 赤を確認** — Run: `npx vitest run lib/search/__tests__/cheapest-path.test.ts`

- [ ] **Step 3: 実装** — `SearchState` に `prev: SearchState | null` を足し、`runSearch` が「状態の一覧」も返せるようにする。目的グループの生きている状態のうち `fare` が最小のものから `prev` をたどる。`findReachable` の戻り値と性能は変えない（`prev` の参照を持つだけ）

- [ ] **Step 4: 緑を確認** — Run: `npm test`

- [ ] **Step 5: Commit** — `feat: 運賃探索で最安経路をたどれるようにする`

---

### Task 6: 合流候補の計算

**Files:**
- Create: `lib/meeting/candidates.ts`、`lib/meeting/types.ts`
- Test: `lib/meeting/__tests__/candidates.test.ts`

**Interfaces:**
- Consumes: `buildKmTree`・`pathEdges`（Task 3）、`fareAlongPath`（Task 4）、`findCheapestPath`（Task 5）、`GraphStore`
- Produces:

```ts
// types.ts
export type Metric = "fare" | "km";
export interface Candidate {
  groupId: string;
  stationId: string;        // グループの代表ノード（dA+dB+2dD が最小のもの）
  name: string; lat: number; lng: number; line: string; operator: string;
  detourA: number; detourB: number; shared: number;   // 物差しの単位（円 or km）
  isDestination: boolean;
}
export interface MeetingResult { fare: Candidate[]; km: Candidate[] }
export class UnreachableError extends Error {}

// candidates.ts。並べ替えはしない（Task 7）
export function findMeetingCandidates(store: GraphStore, aId: string, bId: string, toId: string): MeetingResult;
```

手順の要点（シグネチャとテストだけでは決まらない部分）:
1. A・B・目的駅から `buildKmTree`。A か B から目的駅に届かなければ `UnreachableError`
2. 距離の候補: 各ノード n について `kmDetourA = dA(n) + dD(n) - dA(D)`（B も同様）。グループごとに代表ノードを1つ選び、半分以内のものを `km` に入れる
3. 料金の精査の対象は、距離の遠回りが直接の距離の**1倍以内**のグループに絞る（ふるい分けの網目。半分より広くとるのは、運賃と距離の比率が事業者ごとに違うため。私の判断）
4. A・B それぞれ: `budget = fareAlongPath(A→D の営業キロ最短経路)`、`cheapest = findCheapestPath(A, D の groupId, budget)`。`cheapest` の経路上のグループの集合を持つ
5. 候補 M ごとの通し運賃: M のグループがその集合にあれば `cheapest.fare`。無ければ `fareAlongPath(A→M ++ M→D)`。`detour = max(0, via - cheapest.fare)`。`shared = fareAlongPath(M→D)`
6. 目的駅のグループは常に入れる（`isDestination: true`、`shared: 0`）

- [ ] **Step 1: 失敗するテストを書く**（A-x-M-D の一本道に、B-M の枝が付いたグラフ）

```ts
it("二人の経路が重なる駅では、距離の遠回りが二人とも 0 になる", () => {
  const m = findMeetingCandidates(store, "A", "B", "D").km.find((c) => c.groupId === "gM");
  expect(m).toMatchObject({ detourA: 0, detourB: 0 });
});
```

続けて1件ずつ:
- 「A の背後の駅は、A の遠回りが直接の距離の半分を超えるので候補に入らない」
- 「目的駅は isDestination が true、shared が 0 で必ず入る」
- 「料金の物差しでは、最安経路上の駅の遠回りが 0 円になる」
- 「料金の物差しでは、最安経路から外れた駅は営業キロ最短の経路に沿った運賃で遠回りを出す」
- 「通しの運賃が直接の最安額より安く出ても、遠回りは 0 にする」（Review Focus 5）
- 「同じ groupId の別路線ノードは1候補にまとまる」（Review Focus 1）
- 「A と B が同じ駅なら、経路上の候補は二人とも遠回り 0」（Review Focus 2）
- 「目的駅に線路でつながっていなければ UnreachableError」（Review Focus 4）

- [ ] **Step 2〜4: 赤 → 実装 → 緑** — Run: `npx vitest run lib/meeting/__tests__/candidates.test.ts`

- [ ] **Step 5: 実データで時間を測る**（scratchpad に置いた tsx スクリプト。リポジトリには入れない）

大宮・立川→横浜、大阪・京都→神戸、札幌・小樽→新千歳空港 の3組で、`findMeetingCandidates` の所要時間と候補数を出す。
Expected: 開発機でどれも 1 秒以内（本番の 0.5 vCPU で 2 秒以内に収める余裕）。超えたら、手順3の網目を狭めて測り直す。網目を変えたら、どの値にしたかと測った結果を `lib/meeting/candidates.ts` のコメントに残す

- [ ] **Step 6: Commit** — `feat: 距離でふるい分け、通しの運賃で精査して合流候補を出す`

---

### Task 7: 並べ替え

**Files:**
- Create: `lib/meeting/sort.ts`
- Test: `lib/meeting/__tests__/sort.test.ts`

**Interfaces:**
- Consumes: `Candidate`（Task 6）
- Produces: `export type SortOrder = "detour" | "together"; export function sortCandidates(list: Candidate[], order: SortOrder): Candidate[]`（新しい配列を返す）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("遠回りが少ない順では、遠回りの合計が小さい候補が先に来る", () => {
  expect(sortCandidates([c({ detourA: 50, detourB: 0 }), c({ detourA: 0, detourB: 0 })], "detour")
    .map((x) => x.detourA)).toEqual([0, 50]);
});
```

続けて1件ずつ: 「合計が同じなら二人の差が小さい候補が先」、「差も同じなら一緒に乗る区間が長い候補が先」、「長く一緒の順では shared の降順」、「shared が同じなら遠回りの合計が小さい候補が先」、「どちらの並べ方でも目的駅は最後」。

- [ ] **Step 2〜4: 赤 → 実装 → 緑** — Run: `npx vitest run lib/meeting/__tests__/sort.test.ts`

- [ ] **Step 5: Commit** — `feat: 合流候補を遠回り順・一緒に乗る長さ順で並べる`

---

### Task 8: API（候補一覧・経路）

**Files:**
- Create: `lib/server/meeting-service.ts`、`app/api/meeting/route.ts`、`app/api/meeting/path/route.ts`、`app/api/meeting/query.ts`、`app/api/meeting/config.ts`
- Test: `lib/server/__tests__/meeting-route.test.ts`、`lib/server/__tests__/meeting-path-route.test.ts`
- Modify: `playwright.config.ts`（コメントの config の参照先を `app/api/meeting/config.ts` に）

**Interfaces:**
- Consumes: `findMeetingCandidates`、`UnreachableError`（Task 6）、`buildKmTree`・`pathEdges`・`findCheapestPath`、`clientIp`（Task 2）、`createRateLimiter`、`createResultCache`、`getGraphStore`
- Produces:
  - `GET /api/meeting?a=<id>&b=<id>&to=<id>` → `200 MeetingResult & { meta: { a: string; b: string; to: string } }`（並べ替えは画面側）
  - `GET /api/meeting/path?a=&b=&to=&via=<id>&metric=fare|km` → `200 { legs: { a: [number, number][]; b: [number, number][]; shared: [number, number][] } }`（座標は `[lng, lat]`）
  - `export function meetingPath(store: GraphStore, q: PathQuery): PathResult`（`meeting-service.ts`）

ルートの書き方は fare-map の `app/api/reachable/route.ts` に合わせる（レート制限 → zod 検証 → 404 → 計算）。設定値の環境変数名は `RATE_LIMIT_CAPACITY`（E2E が緩める）と `MEETING_CACHE_ENTRIES`（既定 200）。キャッシュの鍵は `${a}|${b}|${to}`。

- [ ] **Step 1: 失敗するテストを書く**（fare-map の `reachable-route.test.ts` と同じく、`GET` に `NextRequest` を渡して応答を見る）

```ts
it("目的駅が A と同じ駅グループなら 400 で「出発駅と目的駅が同じです」を返す", async () => {
  // to は a と同じ groupId の別路線ノード（実データの新宿の JR と小田急など）
  const res = GET(req(`/api/meeting?a=${shinjukuJr}&b=${tachikawa}&to=${shinjukuOdakyu}`));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "出発駅と目的駅が同じです" });
});
```

続けて1件ずつ:
- 「a・b・to のどれかが無ければ 400」
- 「存在しない駅 id は 404」
- 「線路でつながっていなければ 422 で「線路でつながっていません」」（Review Focus 4）
- 「レート制限を超えると 429 と Retry-After」
- 「正常な3駅なら fare と km の候補一覧を返す」
- （path 側）「metric=km では営業キロ最短の3区間の座標を返す」
- （path 側）「metric=fare で via が最安経路上なら、最安経路を via で区切った座標を返す」
- （path 側）「metric=fare で via が最安経路から外れていれば、営業キロ最短の3区間の座標を返す」

- [ ] **Step 2〜4: 赤 → 実装 → 緑** — Run: `npx vitest run lib/server/__tests__/meeting-route.test.ts lib/server/__tests__/meeting-path-route.test.ts`

- [ ] **Step 5: Commit** — `feat: 合流候補と経路を返す API を足す`

---

### Task 9: 入力・切り替え・比較表

**Files:**
- Create: `hooks/use-meeting.ts`、`components/TripInput.tsx`、`components/ViewToggles.tsx`、`components/CandidateTable.tsx`
- Modify: `components/SearchPanel.tsx`（`label: string` を props に足し、`aria-label` と入力欄の前の文言に使う）、`app/page.tsx`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `GET /api/meeting`（Task 8）、`sortCandidates`・`SortOrder`（Task 7）、`Candidate`・`Metric`（Task 6）、`stubTiles`（`e2e/helpers.ts`）
- Produces:
  - `useMeeting(): { data: (MeetingResult & { meta }) | null; loading: boolean; error: string | null; search(a: string, b: string, to: string): Promise<boolean> }`（fare-map の `use-reachable` と同じく世代カウンタで古い応答を捨てる）
  - `<TripInput a b to onChange(which: "a" | "b" | "to", s: StationSuggestion) />`。文の形「[A] と [B] から [目的駅] へ」。aria-label は「Aさんの出発駅」「Bさんの出発駅」「目的駅」
  - `<ViewToggles metric order onMetric onOrder />`。ラジオボタン2組。「料金／距離」「遠回りが少ない順／長く一緒に乗れる順」。既定は料金・遠回りが少ない順
  - `<CandidateTable candidates metric selectedGroupId onPick(c: Candidate) />`。列は「合流駅」「Aさんの遠回り」「Bさんの遠回り」「一緒に乗る区間」。単位は料金なら「+120円」、距離なら「+3.4km」、0 は「0円」「0km」。目的駅の行は「現地集合（□□）」

- [ ] **Step 1: 失敗する E2E を書く**（`stubTiles` を使う。駅は大宮・立川・横浜）

```ts
test("3駅を入れて検索すると、比較表に合流駅の候補が並び、最後の行が現地集合になる", async ({ page }) => {
  // 入力 → 検索 → 表の行数 > 1、最終行に「現地集合（横浜）」
});
```

続けて1件ずつ: 「並べ方を長く一緒の順に切り替えると、先頭の行の『一緒に乗る区間』が最大になる」、「物差しを距離に切り替えると、表の単位が km になる」。

- [ ] **Step 2: 赤を確認** — Run: `npx playwright test e2e/smoke.spec.ts --project=chromium` / Expected: FAIL

- [ ] **Step 3: 実装** — `page.tsx` は fare-map の構成（デスクトップは左の `aside`、モバイルは `BottomSheet` に同じ `panel` を差し込む）を保つ。出典の `footer` は fare-map の文言のまま残す

- [ ] **Step 4: 緑を確認** — 同じコマンドで PASS。あわせて `npm run lint && npm run typecheck`

- [ ] **Step 5: 使われなくなった fare-map の画面と API を消す** — `BudgetInput`・`StationList`・`hooks/use-reachable.ts`・`app/api/reachable/`・`app/api/route-url/`・`lib/budget.ts`・`lib/server/route-url.ts`・`e2e/boundary.spec.ts` と、それぞれだけを対象にしたテスト。`lib/brackets.ts` は MapView が使っているので Task 10 で消す。`npm test && npm run typecheck` が緑のままであることを確かめる

- [ ] **Step 6: Commit** — `feat: 3駅の入力・切り替え・合流候補の比較表を作る` と `chore: fare-map の予算検索の画面と API を消す` の2コミット

---

### Task 10: 地図に候補と経路を描く

**Files:**
- Modify: `components/MapView.tsx`、`app/page.tsx`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `GET /api/meeting/path`（Task 8）、`Candidate`
- Produces: `MapViewProps = { candidates: Candidate[]; endpoints: { a, b, to: { name: string; lat: number; lng: number } | null }; selected: Candidate | null; legs: PathResult["legs"] | null; resultKey: unknown }`

描き方（fare-map の色の考え方に合わせる）: 候補は1色の円、選んだ候補は大きい印。A・B・目的駅はそれぞれ別の印。経路は A→M と B→M を別の色、M→目的駅 を太い線にする（一緒に乗る区間が目立つように）。背景の liberty の色相（水域の青・公園の緑・道路の橙〜黄）とずらし、dataviz の検証スクリプトで地色に対して 2:1 を超えることを確かめる。新しい検索結果のときだけ全候補と3駅が入るように寄せ、行を選んだときはその経路に寄せる。

- [ ] **Step 1: 失敗する E2E を書く**

```ts
test("表の行を選ぶと、その駅を via にした経路を取りに行き、地図に経路が描かれる", async ({ page }) => {
  // 行をクリック → /api/meeting/path?…via=<その行の stationId> へのリクエストを待つ
  // → 地図の画素に A→M の線の色が一定数以上ある（fare-map の cheapestPixels と同じ数え方）
});
```

続けて: 「物差しを切り替えると、選んだ行の経路を metric を変えて取り直す」。

- [ ] **Step 2〜4: 赤 → 実装 → 緑** — Run: `npx playwright test e2e/smoke.spec.ts --project=chromium`

- [ ] **Step 5: `lib/brackets.ts` とそのテストを消す**（MapView が使わなくなったら）

- [ ] **Step 6: Commit** — `feat: 地図に合流候補と二人の経路を描く`

---

### Task 11: モバイル・公開の仕上げ

**Files:**
- Create: `e2e/mobile.spec.ts`
- Modify: `README.md`、`Dockerfile`（COPY するデータが fare-map と同じであることを確認。差分が無ければ変更なし）、`app/layout.tsx`（タイトル・説明）、`app/icon.svg`・`components/Logo.tsx`（Task の外で新しい図案が決まるまでは fare-map のまま）

- [ ] **Step 1: 失敗する E2E を書く**（Pixel 7）: 「スマホ幅で検索すると、ボトムシートに比較表が出て、行を選ぶとシートが畳まれて地図が見える」

- [ ] **Step 2〜4: 赤 → 実装 → 緑** — Run: `npx playwright test --project=mobile-chrome`

- [ ] **Step 5: 全体の検証** — Run: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run e2e`（出力は末尾だけ見る）/ Expected: すべて成功

- [ ] **Step 6: Docker で起動確認** — `docker build -t meeting-station:local . && docker run -d --name ms-local -p 3000:3000 meeting-station:local` → `curl "http://localhost:3000/api/meeting?a=<大宮>&b=<立川>&to=<横浜>"` が 200 → `docker rm -f ms-local`

- [ ] **Step 7: Commit** — `feat: スマホのボトムシートで比較表を出す` と `docs: README を合流駅さがし向けに書き換える`

Azure のリソース（`meeting-station-rg`・`meeting-station`）と Docker Hub のリポジトリ、GitHub の Secrets（`AZURE_CREDENTIALS` など）を作るのはユーザーの作業。手順は fare-map の `docs/reuse-guide.md` 3章。これが済むまで、main へ Merge してもデプロイのジョブは失敗する。
