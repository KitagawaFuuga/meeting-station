"use client";

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
              <button type="button" className="text-left">
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
