import type { FareCalculator } from "@/lib/fare/calculator";
import type { GraphEdge, RailGraph } from "@/lib/graph/types";
import {
  advanceFareState,
  initialFareState,
  toAdjacentEdge,
  type FareStepContext,
} from "@/lib/search/fare-step";

// 決まった経路を改札を出ずに乗り通したときの運賃。探索と同じ遷移（fare-step.ts）を
// 辺ごとに畳み込むので、JR の通算・加算額・特定都区市内などの規則も同じに効く。
// edges は連続していること（edges[i].to === edges[i+1].from）。空なら 0
export function fareAlongPath(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  edges: GraphEdge[],
): number {
  const ctx: FareStepContext = {
    calc,
    nameOf: (id) => graph.nodes[id]?.name,
  };
  let state = initialFareState(fromId);
  for (const e of edges) {
    state = advanceFareState(ctx, state, toAdjacentEdge(calc, e));
  }
  return state.fare;
}
