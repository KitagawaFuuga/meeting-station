"use client";

import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  detourCategory,
} from "@/lib/candidate-category";
import type { Candidate, Metric } from "@/lib/meeting/types";

export interface CandidateTableProps {
  candidates: Candidate[];
  metric: Metric;
  selectedGroupId: string | null;
  onPick(c: Candidate): void;
}

// 料金は「+120円」、距離は「+3.4km」。0 は符号を付けない
function formatAmount(value: number, metric: Metric, signed: boolean): string {
  const text =
    metric === "fare" ? `${Math.round(value)}円` : `${value.toFixed(1)}km`;
  return signed && value > 0 ? `+${text}` : text;
}

export default function CandidateTable({
  candidates,
  metric,
  selectedGroupId,
  onPick,
}: CandidateTableProps) {
  if (candidates.length === 0) return null;
  // 地図の円の色の凡例。表の各行にも同じ色の点を付け、表そのものも凡例として読めるようにする
  const dot = (color: string) => (
    <span
      aria-hidden="true"
      className="mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
  return (
    <div className="space-y-2">
      <ul
        aria-label="地図の色"
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600"
      >
        {CATEGORY_LABELS.map(([category, label]) => (
          <li key={category} className="flex items-center">
            {dot(CATEGORY_COLORS[category])}
            {label}
          </li>
        ))}
      </ul>
      <CandidateRows
        candidates={candidates}
        metric={metric}
        selectedGroupId={selectedGroupId}
        onPick={onPick}
        dot={dot}
      />
    </div>
  );
}

function CandidateRows({
  candidates,
  metric,
  selectedGroupId,
  onPick,
  dot,
}: CandidateTableProps & { dot(color: string): React.ReactNode }) {
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
          <th className="py-1 font-normal">合流駅</th>
          <th className="py-1 text-right font-normal">Aさんの遠回り</th>
          <th className="py-1 text-right font-normal">Bさんの遠回り</th>
          <th className="py-1 text-right font-normal">一緒に乗る区間</th>
        </tr>
      </thead>
      <tbody>
        {candidates.map((c) => (
          <tr
            key={c.groupId}
            aria-selected={c.groupId === selectedGroupId}
            onClick={() => onPick(c)}
            className="cursor-pointer border-b border-gray-100 hover:bg-gray-50 aria-selected:bg-amber-50"
          >
            <td className="py-1">
              {/* 行全体を押せるが、キーボードでも選べるようにボタンを置く */}
              <button type="button" className="flex items-center text-left">
                {dot(CATEGORY_COLORS[detourCategory(c)])}
                {c.isDestination ? `現地集合（${c.name}）` : c.name}
              </button>
            </td>
            <td className="py-1 text-right">
              {formatAmount(c.detourA, metric, true)}
            </td>
            <td className="py-1 text-right">
              {formatAmount(c.detourB, metric, true)}
            </td>
            <td className="py-1 text-right">
              {formatAmount(c.shared, metric, false)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
