import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { RATE_LIMIT_CAPACITY } from "@/app/api/meeting/config";
import { GET } from "@/app/api/meeting/path/route";
import { GET as listGET } from "@/app/api/meeting/route";

// 実データ(data/graph.json)を読む
const OMIYA = "1131906";
const TACHIKAWA = "1131227";
const YOKOHAMA = "1130105";
const SHINJUKU_JR = "1130208";

let ipSeq = 0;
const call = (query: string) =>
  GET(
    new NextRequest(`http://localhost/api/meeting/path?${query}`, {
      headers: { "x-forwarded-for": `198.51.101.${(ipSeq += 1)}` },
    }),
  );

describe("GET /api/meeting/path", () => {
  it("候補一覧の API の回数制限を使い切っても、経路の API は使える（別々に数える）", async () => {
    // 行を次々に選ぶと経路の API を何度も呼ぶ。同じ制限で数えると、経路の表示が
    // 黙って止まり、次の検索まで 429 になっていた
    const ip = "203.0.113.88";
    const listCall = () =>
      listGET(
        new NextRequest("http://localhost/api/meeting?a=x", {
          headers: { "x-forwarded-for": ip },
        }),
      );
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) await listCall();
    expect((await listCall()).status).toBe(429);
    const res = await GET(
      new NextRequest("http://localhost/api/meeting/path?a=x", {
        headers: { "x-forwarded-for": ip },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("metric が fare・km 以外なら 400 を返す", async () => {
    const res = await call(
      `a=${OMIYA}&b=${TACHIKAWA}&to=${YOKOHAMA}&via=${SHINJUKU_JR}&metric=time`,
    );
    expect(res.status).toBe(400);
  });

  it("正常な問い合わせなら、A の出発駅から始まり目的駅で終わる3区間の座標を返す", async () => {
    const res = await call(
      `a=${OMIYA}&b=${TACHIKAWA}&to=${YOKOHAMA}&via=${SHINJUKU_JR}&metric=fare`,
    );
    expect(res.status).toBe(200);
    const { legs } = (await res.json()) as {
      legs: Record<"a" | "b" | "shared", [number, number][]>;
    };
    // 大宮は北緯 35.9 度、横浜は 35.47 度付近
    expect(legs.a[0]?.[1]).toBeCloseTo(35.9, 0);
    expect(legs.shared.at(-1)?.[1]).toBeCloseTo(35.47, 1);
    // 3区間は合流駅でつながる
    expect(legs.a.at(-1)).toEqual(legs.shared[0]);
    expect(legs.b.at(-1)).toEqual(legs.shared[0]);
    // 候補の計算（運賃探索2回）を抱えるので、並列実行中は5秒を超えることがある
  }, 30000);
});
