import { NextRequest, NextResponse } from "next/server";
import { TooFarError, UnreachableError } from "@/lib/meeting/types";
import { getGraphStore } from "@/lib/server/graph-store";
import { meetingPath } from "@/lib/server/meeting-service";
import { PATH_ERROR, UNREACHABLE_ERROR, pathSchema } from "../query";
import { meetingService, rateLimited } from "../service";

// 表で選ばれた候補の経路。候補一覧に全候補の経路を入れると応答が重くなるので分ける
export function GET(req: NextRequest) {
  const limited = rateLimited(req, "path");
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const parsed = pathSchema.safeParse({
    a: sp.get("a"),
    b: sp.get("b"),
    to: sp.get("to"),
    via: sp.get("via"),
    metric: sp.get("metric"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: PATH_ERROR }, { status: 400 });
  }
  const q = parsed.data;
  const store = getGraphStore();
  if ([q.a, q.b, q.to, q.via].some((id) => !store.graph.nodes[id])) {
    return NextResponse.json({ error: "未知の駅 id" }, { status: 404 });
  }
  try {
    // 料金の経路は候補の計算で求めた最安経路を使う。候補一覧の直後に呼ばれるのでキャッシュに
    // 当たる。距離の経路は最安経路を使わないので、キャッシュが外れたときに候補の計算
    // （運賃探索2回）を走らせない
    const cheapest =
      q.metric === "fare"
        ? meetingService.candidates(store, q).cheapest
        : undefined;
    return NextResponse.json(meetingPath(store, q, cheapest));
  } catch (e) {
    if (e instanceof TooFarError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    if (e instanceof UnreachableError) {
      return NextResponse.json({ error: UNREACHABLE_ERROR }, { status: 422 });
    }
    throw e;
  }
}
