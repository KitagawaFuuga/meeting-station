export type Metric = "fare" | "km";

// 合流駅の候補1つ。数値は物差しの単位（料金なら円、距離なら営業キロ）
export interface Candidate {
  groupId: string;
  stationId: string; // グループの代表ノード（dA+dB+2dD が最小のもの）
  name: string;
  lat: number;
  lng: number;
  line: string;
  operator: string;
  detourA: number;
  detourB: number;
  shared: number; // 合流駅から目的駅まで一緒に乗る区間
  isDestination: boolean;
}

// A・B それぞれの目的駅までの最安経路（駅 id の並び）。地図に料金の経路を描くのに使う
export interface CheapestPaths {
  a: string[];
  b: string[];
}

export interface MeetingResult {
  fare: Candidate[];
  km: Candidate[];
  cheapest: CheapestPaths;
}

// A か B から目的駅まで線路がつながっていない
export class UnreachableError extends Error {}
