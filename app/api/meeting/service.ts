import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/server/client-ip";
import { createMeetingService } from "@/lib/server/meeting-service";
import { createRateLimiter } from "@/lib/server/rate-limit";
import {
  MEETING_CACHE_ENTRIES,
  RATE_LIMIT_CAPACITY,
  RATE_LIMIT_REFILL_PER_SEC,
  RETRY_AFTER_SEC,
} from "./config";

// 候補一覧（route.ts）と経路（path/route.ts）で同じキャッシュとレート制限を使う。
// どちらもモジュールレベルの揮発状態で、min-replicas 0 / 単一インスタンスの構成が前提。
// proxy.ts (旧 middleware.ts) 側に置かないのは、Next.js のドキュメントが
// proxy は CDN に配置されうるため共有モジュールやグローバルに依存するなと明記しているため。
export const meetingService = createMeetingService(MEETING_CACHE_ENTRIES);

const limiter = createRateLimiter({
  capacity: RATE_LIMIT_CAPACITY,
  refillPerSec: RATE_LIMIT_REFILL_PER_SEC,
});

// 制限を超えていれば 429 の応答を返す。検証より先に呼ぶ（検証を先に置くと、
// 不正な入力を投げ続けるだけで無制限にリクエストを受け付けてしまう）
export function rateLimited(req: NextRequest): NextResponse | null {
  if (limiter.take(clientIp(req.headers), Date.now())) return null;
  return NextResponse.json(
    { error: "リクエストが多すぎます。少し待って再試行してください" },
    { status: 429, headers: { "Retry-After": String(RETRY_AFTER_SEC) } },
  );
}
