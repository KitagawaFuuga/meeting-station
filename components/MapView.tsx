"use client";

import { useEffect, useRef } from "react";
import type { FeatureCollection, Point } from "geojson";
import {
  Map as MapLibreMap,
  Marker,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Legs } from "@/hooks/use-meeting-path";
import { boundsOf } from "@/lib/geo";
import type { Candidate } from "@/lib/meeting/types";
import { ROUTE_COLORS } from "@/lib/route-colors";

type Endpoint = { name: string; lat: number; lng: number } | null;

export interface MapViewProps {
  candidates: Candidate[];
  // A・B の出発駅と目的駅。候補の円とは別の印で常に描く
  endpoints: { a: Endpoint; b: Endpoint; to: Endpoint };
  // 表で選ばれた候補。印を重ね、吹き出しを開く
  selected: Candidate | null;
  // 選ばれた候補での二人の経路。届くまでは null
  legs: Legs | null;
  // 新しい検索結果ごとに変わる値。変わったら候補と3駅が全部入るように地図を寄せる。
  // 物差しや並べ方の切り替えでは寄せ直さない（利用者が動かした地図が勝手に戻らないように）
  resultKey: unknown;
}

const CANDIDATE_SOURCE = "candidates";
const CANDIDATE_LAYER = "candidate-circles";
const ROUTE_SOURCE = "routes";
const ROUTE_LAYER = "route-lines";

// maplibre-gl はワーカースクリプトを import.meta.url からの相対パスで解決するが、
// Turbopack がバンドルしたチャンク URL は node_modules 上の相対位置と一致せず 404 になり、
// タイルが永久に読み込み中のまま止まる。public/ に配置した実体を明示的に指定して回避する
// (scripts/copy-maplibre-worker.mjs が npm install / dev / build 前にコピーする)。
setWorkerUrl("/maplibre-gl-worker.mjs");

function candidatesGeoJson(candidates: Candidate[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: candidates.map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      properties: { groupId: c.groupId },
    })),
  };
}

function routesGeoJson(legs: Legs | null): FeatureCollection {
  if (!legs) return { type: "FeatureCollection", features: [] };
  // 一緒に乗る区間を最後に置き、二人の線の上に重ねる
  return {
    type: "FeatureCollection",
    features: (["a", "b", "shared"] as const).map((leg) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: legs[leg] },
      properties: { leg },
    })),
  };
}

const LINE_COLOR: ExpressionSpecification = [
  "match",
  ["get", "leg"],
  "a",
  ROUTE_COLORS.a,
  "b",
  ROUTE_COLORS.b,
  ROUTE_COLORS.shared,
];
// 一緒に乗る区間を太くして目立たせる
const LINE_WIDTH: ExpressionSpecification = [
  "match",
  ["get", "leg"],
  "shared",
  7,
  4,
];

// 円の半径（px）をズームに合わせる。広域では重なりを抑えて小さく、寄るほど押しやすく大きくする
const CIRCLE_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  3,
  9,
  5,
  13,
  8,
];

// 吹き出しの中身。innerHTML ではなく createElement + textContent で組む。
// 駅名は外部データ由来なので、HTML として解釈させない。
function buildPopupContent(c: Candidate): HTMLElement {
  const el = document.createElement("div");
  const nameEl = document.createElement("strong");
  nameEl.textContent = c.isDestination ? `現地集合（${c.name}）` : c.name;
  el.appendChild(nameEl);
  el.appendChild(document.createElement("br"));
  el.appendChild(document.createTextNode(`${c.line} / ${c.operator}`));
  return el;
}

// 3駅の印: 黒い丸に白い縁と、役割つきのラベル。候補の円と見分けられるように色を変える
function buildEndpointElement(label: string, color: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.className = "pointer-events-none flex items-center gap-1";
  const dot = document.createElement("span");
  dot.className = "block h-4 w-4 shrink-0 rounded-full border-[3px] shadow";
  dot.style.borderColor = "#ffffff";
  dot.style.backgroundColor = color;
  const text = document.createElement("span");
  text.className =
    "whitespace-nowrap rounded bg-gray-900/85 px-1.5 py-0.5 text-xs font-bold text-white";
  text.textContent = label;
  el.append(dot, text);
  return el;
}

// 選択中の合流駅の印: 円の外側に重ねる太い縁取り
function buildSelectedElement(name: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `合流駅: ${name}`);
  el.className =
    "pointer-events-none h-7 w-7 rounded-full border-4 border-gray-900 ring-2 ring-white";
  return el;
}

// 3駅は駅名の入力だけで決める。地図は表示と、候補の円を押したときの吹き出しだけを担う
export default function MapView({
  candidates,
  endpoints,
  selected,
  legs,
  resultKey,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const selectedRef = useRef<Marker | null>(null);
  const endpointMarkersRef = useRef<Marker[]>([]);
  // 地図の load より先にデータが届くと、下の setData はソースが無くて空振りする。
  // load でソースを作るときに最新の値を入れられるよう、ref にも持っておく
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const legsRef = useRef(legs);
  legsRef.current = legs;
  const endpointsRef = useRef(endpoints);
  endpointsRef.current = endpoints;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [139.767, 35.681],
      zoom: 9,
      attributionControl: { customAttribution: "駅データ.jp" },
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: routesGeoJson(legsRef.current),
      });
      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": LINE_COLOR, "line-width": LINE_WIDTH },
      });
      map.addSource(CANDIDATE_SOURCE, {
        type: "geojson",
        data: candidatesGeoJson(candidatesRef.current),
      });
      map.addLayer({
        id: CANDIDATE_LAYER,
        type: "circle",
        source: CANDIDATE_SOURCE,
        paint: {
          "circle-radius": CIRCLE_RADIUS,
          "circle-color": ROUTE_COLORS.candidate,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", CANDIDATE_LAYER, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        const c = candidatesRef.current.find(
          (x) => x.groupId === f?.properties?.groupId,
        );
        if (!f || !c) return;
        const [lng, lat] = (f.geometry as Point).coordinates as [
          number,
          number,
        ];
        popupRef.current?.remove();
        popupRef.current = new Popup()
          .setLngLat([lng, lat])
          .setDOMContent(buildPopupContent(c))
          .addTo(map);
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 候補は数百件になるため、DOM マーカーではなく GeoJSON ソースの差し替えで描く
  useEffect(() => {
    const src = mapRef.current?.getSource(CANDIDATE_SOURCE) as
      GeoJSONSource | undefined;
    src?.setData(candidatesGeoJson(candidates));
  }, [candidates]);

  // 経路が届いたら線を描き、二人の経路が全部入るように寄せる
  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
    src?.setData(routesGeoJson(legs));
    if (!map || !legs) return;
    const points = [...legs.a, ...legs.b, ...legs.shared].map(([lng, lat]) => ({
      lng,
      lat,
    }));
    const bounds = boundsOf(points);
    if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 13 });
  }, [legs]);

  // 3駅の印。選び直したら置き換える
  useEffect(() => {
    const map = mapRef.current;
    for (const m of endpointMarkersRef.current) m.remove();
    endpointMarkersRef.current = [];
    if (!map) return;
    const roles = [
      ["a", "A", ROUTE_COLORS.a],
      ["b", "B", ROUTE_COLORS.b],
      ["to", "目的", ROUTE_COLORS.shared],
    ] as const;
    for (const [key, role, color] of roles) {
      const p = endpoints[key];
      if (!p) continue;
      endpointMarkersRef.current.push(
        new Marker({
          element: buildEndpointElement(`${role}: ${p.name}`, color),
          // 要素の左端（丸の左端）を基準にするので、丸の中心が駅の位置に来るよう半径ぶん戻す
          anchor: "left",
          offset: [-8, 0],
        })
          .setLngLat([p.lng, p.lat])
          .addTo(map),
      );
    }
  }, [endpoints]);

  // 選んだ候補に印を重ねる
  useEffect(() => {
    const map = mapRef.current;
    popupRef.current?.remove();
    selectedRef.current?.remove();
    selectedRef.current = null;
    if (!map || !selected) return;
    selectedRef.current = new Marker({
      element: buildSelectedElement(selected.name),
    })
      .setLngLat([selected.lng, selected.lat])
      .addTo(map);
  }, [selected]);

  // 新しい検索結果が届いたら、候補と3駅が全部入るように寄せる。
  // 候補と3駅は ref から読む（依存に入れると、並べ方の切り替えでも寄せ直してしまう）
  useEffect(() => {
    const { a, b, to } = endpointsRef.current;
    const points = [
      ...candidatesRef.current,
      ...[a, b, to].filter((p) => p !== null),
    ];
    const bounds = boundsOf(points);
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: 60, maxZoom: 13 });
  }, [resultKey]);

  return <div ref={containerRef} className="h-full w-full" />;
}
