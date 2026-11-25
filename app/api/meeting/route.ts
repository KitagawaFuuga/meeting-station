import { NextRequest, NextResponse } from "next/server";
import { TooFarError, UnreachableError } from "@/lib/meeting/types";
import { getGraphStore } from "@/lib/server/graph-store";
import {
  SAME_STATION_ERROR,
  TRIP_ERROR,
  UNREACHABLE_ERROR,
  tripSchema,
} from "./query";
import { meetingService, rateLimited } from "./service";

export function GET(req: NextRequest) {
  const limited = rateLimited(req, "list");
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const parsed = tripSchema.safeParse({
    a: sp.get("a"),
    b: sp.get("b"),
    to: sp.get("to"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: TRIP_ERROR }, { status: 400 });
  }
  const { a, b, to } = parsed.data;
  const store = getGraphStore();
  const { graph } = store;
  // 形式は正しいが存在しない駅 id は「入力が不正(400)」ではなく「見つからない(404)」
  if (!graph.nodes[a] || !graph.nodes[b] || !graph.nodes[to]) {
    return NextResponse.json({ error: "未知の駅 id" }, { status: 404 });
  }
  const toGroup = graph.nodes[to]?.groupId;
  if (
    toGroup === graph.nodes[a]?.groupId ||
    toGroup === graph.nodes[b]?.groupId
  ) {
    return NextResponse.json({ error: SAME_STATION_ERROR }, { status: 400 });
  }
  try {
    const { fare, km } = meetingService.candidates(store, { a, b, to });
    return NextResponse.json({ fare, km, meta: { a, b, to } });
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
