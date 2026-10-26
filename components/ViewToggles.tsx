"use client";

import { useId } from "react";
import type { Metric } from "@/lib/meeting/types";
import type { SortOrder } from "@/lib/meeting/sort";

export interface ViewTogglesProps {
  metric: Metric;
  order: SortOrder;
  onMetric(m: Metric): void;
  onOrder(o: SortOrder): void;
}

function Choice<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
}) {
  // パネルはサイドバーとボトムシートの2箇所に描かれる。name が同じだとページ全体で
  // 1つのラジオグループになり、片方を選ぶともう片方の選択が外れる
  const groupName = `${name}-${useId()}`;
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-1">
          <input
            type="radio"
            name={groupName}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export default function ViewToggles({
  metric,
  order,
  onMetric,
  onOrder,
}: ViewTogglesProps) {
  return (
    <div className="space-y-1">
      <Choice
        name="metric"
        legend="測る物差し"
        value={metric}
        options={[
          { value: "fare", label: "料金" },
          { value: "km", label: "距離" },
        ]}
        onChange={onMetric}
      />
      <Choice
        name="order"
        legend="並べ方"
        value={order}
        options={[
          { value: "detour", label: "遠回りが少ない順" },
          { value: "together", label: "長く一緒に乗れる順" },
        ]}
        onChange={onOrder}
      />
    </div>
  );
}
