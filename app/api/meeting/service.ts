import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/server/client-ip";
import { createMeetingService } from "@/lib/server/meeting-service";
import { createRateLimiter } from "@/lib/server/rate-limit";
import {
  MEETING_CACHE_ENTRIES,
  PATH_RATE_LIMIT_CAPACITY,
  PATH_RATE_LIMIT_REFILL_PER_SEC,
  RATE_LIMIT_CAPACITY,
  RATE_LIMIT_REFILL_PER_SEC,
  RETRY_AFTER_SEC,
} from "./config";

// 候補一覧（route.ts）と経路（path/route.ts）で同じキャッシュを使う。
// どちらもモジュールレベルの揮発状態で、min-replicas 0 / 単一インスタンスの構成が前提。
// proxy.ts (旧 middleware.ts) 側に置かないのは、Next.js のドキュメントが
// proxy は CDN に配置されうるため共有モジュールやグローバルに依存するなと明記しているため。
export const meetingService = createMeetingService(MEETING_CACHE_ENTRIES);

// レート制限は候補一覧と経路で別々に数える。同じ制限だと、行を次々に選ぶだけで
// 経路の表示が黙って止まり、次の検索まで 429 になっていた
const limiters = {
  list: createRateLimiter({
    capacity: RATE_LIMIT_CAPACITY,
    refillPerSec: RATE_LIMIT_REFILL_PER_SEC,
  }),
  path: createRateLimiter({
    capacity: PATH_RATE_LIMIT_CAPACITY,
    refillPerSec: PATH_RATE_LIMIT_REFILL_PER_SEC,
  }),
};

// 制限を超えていれば 429 の応答を返す。検証より先に呼ぶ（検証を先に置くと、
// 不正な入力を投げ続けるだけで無制限にリクエストを受け付けてしまう）
export function rateLimited(
  req: NextRequest,
  kind: keyof typeof limiters,
): NextResponse | null {
  if (limiters[kind].take(clientIp(req.headers), Date.now())) return null;
  return NextResponse.json(
    { error: "リクエストが多すぎます。少し待って再試行してください" },
    { status: 429, headers: { "Retry-After": String(RETRY_AFTER_SEC) } },
  );
}
