"use client";

import { useCallback, useRef, useState } from "react";
import type { Candidate } from "@/lib/meeting/types";

export interface MeetingView {
  fare: Candidate[];
  km: Candidate[];
  meta: { a: string; b: string; to: string };
}

export interface UseMeeting {
  data: MeetingView | null;
  loading: boolean;
  error: string | null;
  // 成功したら true。失敗した場合と、後発の検索に追い越されて結果を破棄した場合は false
  search(a: string, b: string, to: string): Promise<boolean>;
}

// 前段のゲートウェイやプロキシは HTML のエラーページを返すことがある。
// JSON として読めなければ、解析エラーの文ではなく状態コードで伝える
export async function errorMessageOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // JSON でない応答。下の汎用の文言にする
  }
  return `サーバーに接続できませんでした（HTTP ${res.status}）`;
}

export function useMeeting(): UseMeeting {
  const [data, setData] = useState<MeetingView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 連続呼び出し時、後発より先発のレスポンスが遅れて届いても古い結果で上書きしないための世代カウンタ
  const requestIdRef = useRef(0);

  const search = useCallback(async (a: string, b: string, to: string) => {
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ a, b, to });
      const res = await fetch(`/api/meeting?${q}`);
      if (!res.ok) throw new Error(await errorMessageOf(res));
      const result = (await res.json()) as MeetingView;
      if (isStale()) return false;
      setData(result);
      return true;
    } catch (e) {
      if (isStale()) return false;
      setError(e instanceof Error ? e.message : "検索に失敗しました");
      return false;
    } finally {
      // 無条件に false にすると、古いレスポンスが新しいリクエストの実行中表示を消してしまう
      if (!isStale()) setLoading(false);
    }
  }, []);

  return { data, loading, error, search };
}
