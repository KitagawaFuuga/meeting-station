"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import CandidateTable from "@/components/CandidateTable";
import Logo from "@/components/Logo";
import TripInput, { type TripField } from "@/components/TripInput";
import ViewToggles from "@/components/ViewToggles";
import { useMeeting } from "@/hooks/use-meeting";
import { useMeetingPath } from "@/hooks/use-meeting-path";
import { sortCandidates, type SortOrder } from "@/lib/meeting/sort";
import type { Candidate, Metric } from "@/lib/meeting/types";
import type { SheetState } from "@/lib/sheet";
import type { StationSuggestion } from "@/lib/server/api-service";

// maplibre は初期化時に window/document を直接触るため、サーバー側レンダリングで
// 落ちる。"use client" は「ブラウザでも動く」宣言であって SSR を止めないので、
// ssr: false を明示する必要がある。副次的に初期バンドルからも外れる。
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type Trip = Record<TripField, StationSuggestion | null>;

export default function Home() {
  // 3駅は駅名の入力（TripInput）だけで決める。地図のクリックや現在地からは決めない
  const [trip, setTrip] = useState<Trip>({ a: null, b: null, to: null });
  const [metric, setMetric] = useState<Metric>("fare");
  const [order, setOrder] = useState<SortOrder>("detour");
  // 選んだ駅は、どの検索結果の表で選んだかと組で持つ
  const [picked, setPicked] = useState<{
    meta: unknown;
    candidate: Candidate;
  } | null>(null);
  const [sheet, setSheet] = useState<SheetState>("half");
  const { data, loading, error, search } = useMeeting();

  const candidates = useMemo(
    () => (data ? sortCandidates(data[metric], order) : []),
    [data, metric, order],
  );

  // 選んだ駅が今の表に無ければ選んでいない扱いにする。検索中に前の表の行を押したまま
  // 新しい結果が届いたときや、物差しを切り替えて一覧から消えたときに、別の組の経路を
  // 取りに行ったり、表に無い駅の印を残したりしないため
  const selected =
    picked !== null &&
    picked.meta === data?.meta &&
    candidates.some((c) => c.groupId === picked.candidate.groupId)
      ? picked.candidate
      : null;

  // 物差しを切り替えたら、選んだ駅の経路もその物差しで取り直す
  const legs = useMeetingPath(
    data?.meta ?? null,
    selected?.stationId ?? null,
    metric,
  );

  const runSearch = useCallback(async () => {
    // ボタンの disabled とは別の二重の防御。この行のおかげで以降は非 null 扱いになる
    if (!trip.a || !trip.b || !trip.to) return;
    setPicked(null);
    await search(trip.a.id, trip.b.id, trip.to.id);
  }, [trip, search]);

  // 同じ操作パネルを、デスクトップでは左サイドバー、モバイルではボトムシートに
  // 差し込む。JSX を変数に持つことで2箇所に同じマークアップを書かずに済む。
  const panel = (
    <div className="space-y-4">
      <TripInput
        a={trip.a}
        b={trip.b}
        to={trip.to}
        onChange={(which, s) => setTrip((t) => ({ ...t, [which]: s }))}
      />
      <button
        type="button"
        disabled={!trip.a || !trip.b || !trip.to || loading}
        onClick={runSearch}
        className="w-full rounded bg-[#a54700] py-2 font-medium text-white disabled:opacity-40"
      >
        {loading ? "検索中…" : "検索"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && (
        <ViewToggles
          metric={metric}
          order={order}
          onMetric={setMetric}
          onOrder={setOrder}
        />
      )}
      <CandidateTable
        candidates={candidates}
        metric={metric}
        selectedGroupId={selected?.groupId ?? null}
        onPick={(c) => {
          setPicked({ meta: data?.meta, candidate: c });
          // スマホでは選んだ合流駅の経路を見せるため、シートを畳んで地図を主役にする
          setSheet("collapsed");
        }}
      />
      {/* CC BY 4.0 のデータ（運行本数データ・公共交通オープンデータセンター）は
          表示が条件なので、出典から外さないこと。改変の有無（加工して使用）と、
          運行本数データの ODbL の表示も条件。詳細は README の出典節 */}
      <footer className="pt-4 text-xs text-gray-400">
        出典: OpenStreetMap / OpenFreeMap / 駅データ.jp / 全国鉄道運行本数データ
        / 公共交通オープンデータセンター /
        高松琴平電気鉄道・沖縄都市モノレール・札幌市交通局の公開GTFS
        （最後の4つは CC BY 4.0、全国鉄道運行本数データは ODbL 1.0
        も。いずれも加工して使用）。運賃は概算です。
      </footer>
    </div>
  );

  return (
    <main className="flex h-dvh">
      <aside className="hidden w-[28rem] shrink-0 overflow-y-auto border-r border-gray-200 p-4 md:block">
        <h1 className="mb-4 flex items-center gap-2 text-lg font-bold">
          <Logo className="h-7 w-7" />
          合流駅さがし
        </h1>
        {panel}
      </aside>
      <div className="relative flex-1">
        <MapView
          candidates={candidates}
          endpoints={trip}
          selected={selected}
          legs={legs}
          resultKey={data?.meta}
        />
      </div>
      <BottomSheet state={sheet} onStateChange={setSheet}>
        {panel}
      </BottomSheet>
    </main>
  );
}
