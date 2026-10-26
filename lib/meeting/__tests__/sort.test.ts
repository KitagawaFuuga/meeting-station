import { describe, expect, it } from "vitest";
import { limitCandidates, sortCandidates } from "@/lib/meeting/sort";
import type { Candidate } from "@/lib/meeting/types";

let seq = 0;
const c = (over: Partial<Candidate>): Candidate => {
  seq += 1;
  return {
    groupId: `g${seq}`,
    stationId: `s${seq}`,
    name: `駅${seq}`,
    lat: 35,
    lng: 139,
    line: "L線",
    operator: "OpA",
    detourA: 0,
    detourB: 0,
    shared: 0,
    isDestination: false,
    ...over,
  };
};

describe("sortCandidates", () => {
  it("遠回りが少ない順では、遠回りの合計が小さい候補が先に来る", () => {
    const sorted = sortCandidates(
      [c({ detourA: 50, detourB: 0 }), c({ detourA: 0, detourB: 0 })],
      "detour",
    );
    expect(sorted.map((x) => x.detourA)).toEqual([0, 50]);
  });

  it("遠回りの合計が同じなら、二人の差が小さい候補が先に来る", () => {
    const sorted = sortCandidates(
      [c({ detourA: 60, detourB: 0 }), c({ detourA: 30, detourB: 30 })],
      "detour",
    );
    expect(sorted.map((x) => x.detourA)).toEqual([30, 60]);
  });

  it("差も同じなら、一緒に乗る区間が長い候補が先に来る", () => {
    const sorted = sortCandidates(
      [c({ shared: 10 }), c({ shared: 30 })],
      "detour",
    );
    expect(sorted.map((x) => x.shared)).toEqual([30, 10]);
  });

  it("長く一緒に乗れる順では、一緒に乗る区間が長い候補が先に来る", () => {
    const sorted = sortCandidates(
      [
        c({ shared: 10 }),
        c({ shared: 30, detourA: 50 }),
        c({ shared: 20, detourB: 10 }),
      ],
      "together",
    );
    expect(sorted.map((x) => x.shared)).toEqual([30, 20, 10]);
  });

  it("長く一緒に乗れる順で区間が同じなら、遠回りの合計が小さい候補が先に来る", () => {
    const sorted = sortCandidates(
      [c({ shared: 20, detourA: 40 }), c({ shared: 20, detourB: 10 })],
      "together",
    );
    expect(sorted.map((x) => x.detourA + x.detourB)).toEqual([10, 40]);
  });

  it.each(["detour", "together"] as const)(
    "%s の並べ方でも、目的駅（現地集合）は最後に来る",
    (order) => {
      const dest = c({ isDestination: true });
      // 目的駅は遠回り 0・区間 0 なので、遠回り順では本来先頭に来る
      const sorted = sortCandidates(
        [dest, c({ detourA: 30, shared: 0 }), c({ detourA: 10, shared: 5 })],
        order,
      );
      expect(sorted.at(-1)).toBe(dest);
    },
  );
});

describe("limitCandidates", () => {
  it("どちらの並べ方でも上位 n 件に入る候補と、目的駅だけを残す", () => {
    const fewestDetour = c({ detourA: 0, shared: 5 });
    const longestTogether = c({ detourA: 40, shared: 50 });
    const neither = c({ detourA: 30, shared: 10 });
    const dest = c({ isDestination: true });
    const kept = limitCandidates(
      [neither, dest, longestTogether, fewestDetour],
      1,
    );
    expect(new Set(kept)).toEqual(
      new Set([fewestDetour, longestTogether, dest]),
    );
  });
});
