"use client";

import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface PieChartProps {
  data: {
    name: string;
    value: number;
    color: string;
  }[];
  height?: number;
  title?: string;
  innerRadius?: number;
}

const CustomTooltip = ({ active, payload }: {
  active?: boolean;
  payload?: { name: string; value: number; payload: { color: string; percent: number } }[];
}) => {
  if (active && payload && payload.length) {
    const item = payload[0];
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 shadow-xl">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.payload.color }} />
          <span className="text-sm text-gray-300">{item.name}</span>
        </div>
        <div className="text-sm font-bold text-white">{item.value.toLocaleString()}</div>
        <div className="text-xs text-gray-400">{(item.payload.percent * 100).toFixed(1)}%</div>
      </div>
    );
  }
  return null;
};

const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}) => {
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

export default function PieChart({ data, height = 300, title, innerRadius = 60 }: PieChartProps) {
  return (
    <div>
      {title && <h3 className="text-sm font-medium text-gray-300 mb-4">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <RechartsPieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={Math.min(height / 2 - 30, 110)}
            paddingAngle={2}
            dataKey="value"
            labelLine={false}
            label={renderCustomLabel}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => (
              <span style={{ color: "#9ca3af", fontSize: "12px" }}>{value}</span>
            )}
            wrapperStyle={{ paddingTop: "16px" }}
          />
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}
