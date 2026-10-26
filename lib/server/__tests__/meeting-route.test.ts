import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { RATE_LIMIT_CAPACITY } from "@/app/api/meeting/config";
import { GET } from "@/app/api/meeting/route";

// 実データ(data/graph.json)を読む。新宿の JR山手線と小田急線は同じ駅グループ
const SHINJUKU_JR = "1130208";
const SHINJUKU_ODAKYU = "2500101";
const TACHIKAWA = "1131227";
const SHURI = "9992715"; // ゆいレール。本州とは線路でつながっていない
const OMIYA = "1131906";
const YOKOHAMA = "1130105";
const TOKYO = "1130101";
const HAKATA = "1190231";

let ipSeq = 0;
const call = (query: string, ip = `198.51.100.${(ipSeq += 1)}`) =>
  GET(
    new NextRequest(`http://localhost/api/meeting?${query}`, {
      headers: { "x-forwarded-for": ip },
    }),
  );

describe("GET /api/meeting", () => {
  it("目的駅が A と同じ駅グループなら 400 で「出発駅と目的駅が同じです」を返す", async () => {
    const res = await call(
      `a=${SHINJUKU_JR}&b=${TACHIKAWA}&to=${SHINJUKU_ODAKYU}`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "出発駅と目的駅が同じです" });
  });

  it("a・b・to のどれかが無ければ 400 を返す", async () => {
    const res = await call(`a=${SHINJUKU_JR}&b=${TACHIKAWA}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "a・b・to（駅 id）を指定" });
  });

  it("存在しない駅 id なら 404 を返す", async () => {
    const res = await call(`a=nope&b=${TACHIKAWA}&to=${SHINJUKU_JR}`);
    expect(res.status).toBe(404);
  });

  it("線路でつながっていなければ 422 で「線路でつながっていません」を返す", async () => {
    const res = await call(`a=${SHURI}&b=${TACHIKAWA}&to=${SHINJUKU_JR}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "線路でつながっていません" });
  });

  it("まっすぐ行く運賃が 1 万円を超える組は 422 で「遠すぎて合流駅を探せません」を返す", async () => {
    const res = await call(`a=${TOKYO}&b=${TACHIKAWA}&to=${HAKATA}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "遠すぎて合流駅を探せません" });
    // 探索の前に断るので速いが、グラフの読み込みと最短経路木の作成はかかる
  }, 30000);

  it("同じ IP から容量を超えて叩くと 429 と Retry-After を返す", async () => {
    // 入力が不正な問い合わせでも数える（検証より先に制限を掛ける）。計算が走らないので速い
    const ip = "203.0.113.77";
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) {
      expect((await call("a=x", ip)).status).toBe(400);
    }
    const blocked = await call("a=x", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("正常な3駅なら、料金と距離の候補一覧を返し、どちらにも目的駅が入る", async () => {
    const res = await call(`a=${OMIYA}&b=${TACHIKAWA}&to=${YOKOHAMA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fare: { name: string; isDestination: boolean }[];
      km: { name: string; isDestination: boolean }[];
      meta: unknown;
    };
    expect(body.meta).toEqual({ a: OMIYA, b: TACHIKAWA, to: YOKOHAMA });
    // 最安経路は経路の API の内部で使うだけなので返さない
    expect(body).not.toHaveProperty("cheapest");
    for (const list of [body.fare, body.km]) {
      expect(list.find((c) => c.isDestination)?.name).toBe("横浜");
      expect(list.length).toBeGreaterThan(1);
    }
    // 実データで運賃探索を2回走らせるので、並列実行中は5秒を超えることがある
  }, 30000);
});
