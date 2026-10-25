function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 1 IP が瞬間的に出せるリクエスト数。E2E は同じ IP から叩くので環境変数で緩める */
export const RATE_LIMIT_CAPACITY = envInt("RATE_LIMIT_CAPACITY", 20);

/**
 * 定常的に許すレート。候補の計算は運賃探索を2回走らせ、1回で秒単位の CPU を使うため、
 * 連続して投げられても 1 コンテナを埋めない値にする。
 */
export const RATE_LIMIT_REFILL_PER_SEC = 0.5;

/** 429 で返す Retry-After（秒）。1 トークン回復するまでの時間。 */
export const RETRY_AFTER_SEC = Math.ceil(1 / RATE_LIMIT_REFILL_PER_SEC);

/** 同じ3駅の組の結果を使い回す件数。経路の API もこの結果を使う */
export const MEETING_CACHE_ENTRIES = envInt("MEETING_CACHE_ENTRIES", 200);
