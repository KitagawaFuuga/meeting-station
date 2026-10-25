import { z } from "zod";

// 候補一覧（route.ts）と経路（path/route.ts）で共有する入力検証
export const tripSchema = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  to: z.string().min(1),
});

export const pathSchema = tripSchema.extend({
  via: z.string().min(1),
  metric: z.enum(["fare", "km"]),
});

export const TRIP_ERROR = "a・b・to（駅 id）を指定";
export const PATH_ERROR = "a・b・to・via（駅 id）と metric（fare か km）を指定";
export const SAME_STATION_ERROR = "出発駅と目的駅が同じです";
export const UNREACHABLE_ERROR = "線路でつながっていません";
