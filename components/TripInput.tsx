"use client";

import SearchPanel from "@/components/SearchPanel";
import type { StationSuggestion } from "@/lib/server/api-service";

export type TripField = "a" | "b" | "to";

export interface TripInputProps {
  a: StationSuggestion | null;
  b: StationSuggestion | null;
  to: StationSuggestion | null;
  onChange(which: TripField, station: StationSuggestion): void;
}

// 「［A］と ［B］から ［目的駅］へ」の文の形で3駅を入れる
export default function TripInput({ a, b, to, onChange }: TripInputProps) {
  return (
    <div className="space-y-2">
      <SearchPanel
        label="Aさんの出発駅"
        suffix="と"
        selected={a}
        onSelect={(s) => onChange("a", s)}
      />
      <SearchPanel
        label="Bさんの出発駅"
        suffix="から"
        selected={b}
        onSelect={(s) => onChange("b", s)}
      />
      <SearchPanel
        label="目的駅"
        suffix="へ"
        selected={to}
        onSelect={(s) => onChange("to", s)}
      />
    </div>
  );
}
