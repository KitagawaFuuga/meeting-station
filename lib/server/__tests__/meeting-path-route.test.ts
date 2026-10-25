import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/meeting/path/route";

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
