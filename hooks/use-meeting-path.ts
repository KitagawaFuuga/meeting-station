"use client";

import { useEffect, useState } from "react";
import type { Metric } from "@/lib/meeting/types";
import type { PathResult } from "@/lib/server/meeting-service";

export type Legs = PathResult["legs"];

// 選んだ候補の経路。候補か物差しが変わるたびに取り直す。
// 取れなくても表はそのまま使えるので、失敗したら線を出さないだけにする
export function useMeetingPath(
  meta: { a: string; b: string; to: string } | null,
  via: string | null,
  metric: Metric,
): Legs | null {
  const [legs, setLegs] = useState<Legs | null>(null);

  useEffect(() => {
    setLegs(null);
    if (!meta || !via) return;
    // 後から選び直したとき、先の応答が遅れて届いても古い経路で上書きしない
    let stale = false;
    const q = new URLSearchParams({ ...meta, via, metric });
    fetch(`/api/meeting/path?${q}`)
      .then(async (res) => {
        if (!res.ok || stale) return;
        const body = (await res.json()) as PathResult;
        if (!stale) setLegs(body.legs);
      })
      .catch(() => {
        // 通信の失敗。線を出さないだけにする
      });
    return () => {
      stale = true;
    };
  }, [meta, via, metric]);

  return legs;
}
